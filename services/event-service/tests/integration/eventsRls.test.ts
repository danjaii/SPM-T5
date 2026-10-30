import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * Per-role RLS on events and its child tables (migration 11, SCRUM-91). Every check signs in as a
 * seeded user, so it goes through the same JWT + publishable-key path event-service uses. Fixtures
 * are created with the secret key (which bypasses RLS) and are prefixed "IT-", dated 2031 and
 * removed afterwards.
 */
const EMAILS = {
  coordinatorA: "rachel.tan@connectsphere.example.com",
  coordinatorB: "marcus.lim@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  technicalSupport: "aaron.koh@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
  otherAttendee: "bryan.ho@example.com",
  organiserA: "jason.chua@techconnect.example.com",
  organiserB: "weiling.ong@techconnect.example.com",
};

/** Postgres "insufficient_privilege": an RLS WITH CHECK failure, a missing grant, or the status guard. */
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-91 events row level security (migration 11)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];

  // Organiser A / coordinator A own eventA; organiser B / coordinator B own eventB.
  let eventA: string;
  let eventB: string;
  let draftEvent: string; // organiser A, coordinator A, still a draft
  let statusEvent: string; // organiser A, coordinator A: the status-change tests mutate this one
  let assignEvent: string; // organiser A, coordinator A: the assignment test mutates this one
  let bookedEvent: string; // has a venue booking
  let supportedEvent: string; // has a technical support request
  let registeredEvent: string; // the attendee is registered, and it has a session

  async function newEvent(organiser: string, coordinator: string | null, status = "submitted"): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-event-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: organiser,
        assigned_coordinator_id: coordinator,
        status,
        is_draft: status === "draft",
        expected_attendance: 50,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  /** How many rows of `table` the actor can see for this event (the events table is keyed by id). */
  const visible = async (actor: Actor, id: string, table = "events") => {
    const column = table === "events" ? "id" : "event_id";
    const { data } = await actor.client.from(table).select(column).eq(column, id);
    return (data ?? []).length;
  };

  const statusOf = async (id: string) =>
    ((await admin.from("events").select("status").eq("id", id).maybeSingle()).data?.status as string | undefined);

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    eventA = await newEvent(who.organiserA.userId, who.coordinatorA.userId);
    eventB = await newEvent(who.organiserB.userId, who.coordinatorB.userId);
    draftEvent = await newEvent(who.organiserA.userId, who.coordinatorA.userId, "draft");
    statusEvent = await newEvent(who.organiserA.userId, who.coordinatorA.userId);
    assignEvent = await newEvent(who.organiserA.userId, who.coordinatorA.userId);

    bookedEvent = await newEvent(who.organiserB.userId, who.coordinatorB.userId);
    const { data: venue } = await admin.from("venues").select("id").limit(1).single();
    const booking = await admin.from("venue_bookings").insert({
      event_id: bookedEvent,
      venue_id: venue!.id,
      requested_by: who.coordinatorB.userId,
      status: "requested",
      event_start_datetime: "2031-06-15T01:00:00Z",
      event_end_datetime: "2031-06-15T09:00:00Z",
    });
    if (booking.error) throw new Error(booking.error.message);

    supportedEvent = await newEvent(who.organiserB.userId, who.coordinatorB.userId);
    const support = await admin
      .from("technical_support_requests")
      .insert({ event_id: supportedEvent, description: "IT support", requested_by: who.coordinatorB.userId });
    if (support.error) throw new Error(support.error.message);

    registeredEvent = await newEvent(who.organiserB.userId, who.coordinatorB.userId);
    const registration = await admin
      .from("event_registrations")
      .insert({ event_id: registeredEvent, attendee_id: who.attendee.userId, status: "withdrawn" });
    if (registration.error) throw new Error(registration.error.message);
    const session = await admin.from("event_sessions").insert({
      event_id: registeredEvent,
      session_name: "IT session",
      session_date: "2031-06-15",
      start_time: "09:00",
      end_time: "10:00",
      sequence_no: 1,
    });
    if (session.error) throw new Error(session.error.message);
  });

  afterAll(async () => {
    if (eventIds.length === 0) return;
    await admin.from("venue_bookings").delete().in("event_id", eventIds);
    await admin.from("events").delete().in("id", eventIds); // cascades history, sessions, documents, requests
  });

  describe("events: who can read an event", () => {
    it("SCRUM-91/AC1 an organiser reads their own events and nobody else's", async () => {
      expect(await visible(who.organiserA, eventA)).toBe(1);
      expect(await visible(who.organiserA, eventB)).toBe(0);
      expect(await visible(who.organiserB, eventB)).toBe(1);
      expect(await visible(who.organiserB, eventA)).toBe(0);
    });

    // SCRUM-156 replaced "any coordinator reads any submitted event" (coordinatorEventReads.test.ts has the full set)
    it("SCRUM-156 a coordinator reads the submitted events assigned to them and none assigned to another", async () => {
      expect(await visible(who.coordinatorA, eventA)).toBe(1);
      expect(await visible(who.coordinatorA, eventB)).toBe(0);
      expect(await visible(who.coordinatorB, eventB)).toBe(1);
      expect(await visible(who.coordinatorB, eventA)).toBe(0);
    });

    it("SCRUM-91/AC2 a draft is visible to its organiser and assigned coordinator only", async () => {
      expect(await visible(who.organiserA, draftEvent)).toBe(1);
      expect(await visible(who.coordinatorA, draftEvent)).toBe(1);
      for (const other of [who.coordinatorB, who.organiserB, who.venueStaff, who.technicalSupport, who.attendee]) {
        expect(await visible(other, draftEvent)).toBe(0);
      }
    });

    it("SCRUM-91/AC2 an attendee reads only events they have registered for, even a withdrawn one", async () => {
      expect(await visible(who.attendee, eventA)).toBe(0);
      expect(await visible(who.attendee, eventB)).toBe(0);
      expect(await visible(who.attendee, registeredEvent)).toBe(1);
      expect(await visible(who.otherAttendee, registeredEvent)).toBe(0);
    });

    it("SCRUM-91 venue staff read events that have a venue booking, and no others", async () => {
      expect(await visible(who.venueStaff, bookedEvent)).toBe(1);
      expect(await visible(who.venueStaff, eventA)).toBe(0);
    });

    it("SCRUM-91 technical support reads events with a support request, and no others", async () => {
      expect(await visible(who.technicalSupport, supportedEvent)).toBe(1);
      expect(await visible(who.technicalSupport, eventA)).toBe(0);
    });
  });

  describe("events: who can change an event", () => {
    it("SCRUM-91/AC1 organisers, venue staff, technical support and attendees cannot update an event", async () => {
      for (const actor of [who.organiserA, who.venueStaff, who.technicalSupport, who.attendee]) {
        const { data } = await actor.client
          .from("events")
          .update({ status: "approved" })
          .eq("id", statusEvent)
          .select("id");
        expect(data ?? []).toHaveLength(0);
      }
      expect(await statusOf(statusEvent)).toBe("submitted");
    });

    // SCRUM-156: the event is invisible to a coordinator who is not assigned, so the update and the function find no row
    // to change (before, the status guard answered 42501). Nothing changes and nothing is recorded either way.
    it("SCRUM-91/AC3 a coordinator who is not assigned cannot change the status, directly or through change_event_status", async () => {
      const direct = await who.coordinatorB.client.from("events").update({ status: "approved" }).eq("id", statusEvent).select("id");
      expect(direct.error).toBeNull();
      expect(direct.data ?? []).toHaveLength(0);
      const rpc = await who.coordinatorB.client.rpc("change_event_status", {
        p_event_id: statusEvent,
        p_new_status: "approved",
        p_reason: "not mine",
      });
      expect(rpc.data ?? []).toHaveLength(0);
      expect(await statusOf(statusEvent)).toBe("submitted");
      const { data: history } = await admin.from("event_status_history").select("id").eq("event_id", statusEvent);
      expect(history ?? []).toHaveLength(0);
    });

    it("SCRUM-91/AC6 the assigned coordinator changes the status and it is recorded in their name", async () => {
      const { error } = await who.coordinatorA.client.rpc("change_event_status", {
        p_event_id: statusEvent,
        p_new_status: "approved",
        p_reason: "looks good",
      });
      expect(error).toBeNull();
      expect(await statusOf(statusEvent)).toBe("approved");
      const { data: history } = await admin
        .from("event_status_history")
        .select("old_status, new_status, changed_by")
        .eq("event_id", statusEvent);
      expect(history).toEqual([{ old_status: "submitted", new_status: "approved", changed_by: who.coordinatorA.userId }]);
    });

    // SCRUM-78/SCRUM-79: the "any coordinator may assign" half was retired; only a Lead changes the coordinator now
    // (leadAssign.test.ts and leadReassign.test.ts check coordinators are refused). Organisers still may not.
    it("SCRUM-91/AC6 organisers may not assign a coordinator", async () => {
      const asOrganiser = await who.organiserA.client
        .from("events")
        .update({ assigned_coordinator_id: who.coordinatorB.userId })
        .eq("id", assignEvent)
        .select("id");
      expect(asOrganiser.data ?? []).toHaveLength(0);
    });

    it("SCRUM-91 a coordinator cannot rewrite columns other than status and assigned_coordinator_id", async () => {
      const { error } = await who.coordinatorA.client.from("events").update({ name: "renamed" }).eq("id", eventA);
      expect(error?.code).toBe(DENIED);
      const { error: organiser } = await who.coordinatorA.client
        .from("events")
        .update({ organiser_id: who.coordinatorA.userId })
        .eq("id", eventA);
      expect(organiser?.code).toBe(DENIED);
    });

    it("SCRUM-91/AC2 a coordinator cannot update another coordinator's draft", async () => {
      const { data } = await who.coordinatorB.client
        .from("events")
        .update({ assigned_coordinator_id: who.coordinatorB.userId })
        .eq("id", draftEvent)
        .select("id");
      expect(data ?? []).toHaveLength(0);
    });

    it("SCRUM-91 nobody creates or deletes an event through the API yet", async () => {
      for (const actor of [who.organiserA, who.coordinatorA]) {
        const insert = await actor.client
          .from("events")
          .insert({ name: "IT-nope", organiser_id: who.organiserA.userId });
        expect(insert.error?.code).toBe(DENIED);
        const { data } = await actor.client.from("events").delete().eq("id", eventA).select("id");
        expect(data ?? []).toHaveLength(0);
      }
    });
  });

  describe("history tables", () => {
    it("SCRUM-91/AC4 status history is readable by the event's coordinator and organiser only", async () => {
      await admin
        .from("event_status_history")
        .insert({ event_id: eventA, old_status: "draft", new_status: "submitted", changed_by: who.organiserA.userId });
      expect(await visible(who.coordinatorA, eventA, "event_status_history")).toBeGreaterThan(0);
      expect(await visible(who.organiserA, eventA, "event_status_history")).toBeGreaterThan(0);
      for (const other of [who.coordinatorB, who.organiserB, who.attendee, who.venueStaff, who.technicalSupport]) {
        expect(await visible(other, eventA, "event_status_history")).toBe(0);
      }
    });

    it("SCRUM-91/AC4 status history cannot be edited or deleted by any role", async () => {
      const { data: row } = await admin.from("event_status_history").select("id").eq("event_id", eventA).limit(1).single();
      for (const actor of [who.coordinatorA, who.coordinatorB, who.organiserA, who.venueStaff]) {
        expect((await actor.client.from("event_status_history").update({ reason: "edited" }).eq("id", row!.id)).error?.code).toBe(DENIED);
        expect((await actor.client.from("event_status_history").delete().eq("id", row!.id)).error?.code).toBe(DENIED);
      }
    });

    it("SCRUM-91/AC4 only the assigned coordinator may add a status history row, and only in their own name", async () => {
      const row = (changedBy: string) => ({
        event_id: eventA,
        old_status: "submitted",
        new_status: "approved",
        changed_by: changedBy,
      });
      expect((await who.coordinatorB.client.from("event_status_history").insert(row(who.coordinatorB.userId))).error?.code).toBe(DENIED);
      expect((await who.organiserA.client.from("event_status_history").insert(row(who.organiserA.userId))).error?.code).toBe(DENIED);
      expect((await who.coordinatorA.client.from("event_status_history").insert(row(who.coordinatorB.userId))).error?.code).toBe(DENIED);
      expect((await who.coordinatorA.client.from("event_status_history").insert(row(who.coordinatorA.userId))).error).toBeNull();
    });

    it("SCRUM-91/AC4 coordinator history: coordinators add rows in their own name, nobody edits or deletes", async () => {
      const row = (assignedBy: string) => ({
        event_id: eventA,
        coordinator_id: who.coordinatorA.userId,
        assigned_by: assignedBy,
      });
      expect((await who.coordinatorA.client.from("event_coordinator_history").insert(row(who.coordinatorB.userId))).error?.code).toBe(DENIED);
      expect((await who.organiserA.client.from("event_coordinator_history").insert(row(who.organiserA.userId))).error?.code).toBe(DENIED);
      // SCRUM-156: the new row is read back through RLS, so it is the event's coordinator who adds it here
      const ok = await who.coordinatorA.client.from("event_coordinator_history").insert(row(who.coordinatorA.userId)).select("id").single();
      expect(ok.error).toBeNull();
      expect((await who.coordinatorA.client.from("event_coordinator_history").update({ unassigned_at: new Date().toISOString() }).eq("id", ok.data!.id)).error?.code).toBe(DENIED);
      expect((await who.coordinatorA.client.from("event_coordinator_history").delete().eq("id", ok.data!.id)).error?.code).toBe(DENIED);
      expect(await visible(who.organiserA, eventA, "event_coordinator_history")).toBeGreaterThan(0);
      expect(await visible(who.organiserB, eventA, "event_coordinator_history")).toBe(0);
    });
  });

  describe("sessions, documents and change requests", () => {
    it("SCRUM-91/AC2 a session is visible to whoever can read its event, so a registered attendee sees it", async () => {
      expect(await visible(who.attendee, registeredEvent, "event_sessions")).toBe(1);
      expect(await visible(who.coordinatorB, registeredEvent, "event_sessions")).toBe(1);
      expect(await visible(who.coordinatorA, registeredEvent, "event_sessions")).toBe(0);
      expect(await visible(who.organiserB, registeredEvent, "event_sessions")).toBe(1);
      expect(await visible(who.otherAttendee, registeredEvent, "event_sessions")).toBe(0);
      expect(await visible(who.organiserA, registeredEvent, "event_sessions")).toBe(0);
    });

    it("SCRUM-91/AC2 documents and change requests are visible to the event's coordinator and organiser only", async () => {
      const doc = await admin.from("event_documents").insert({ event_id: eventA, file_name: "IT.pdf", file_url: "x" });
      const change = await admin
        .from("event_change_requests")
        .insert({ event_id: eventA, requested_by: who.organiserA.userId, change_description: "IT change" });
      expect(doc.error).toBeNull();
      expect(change.error).toBeNull();
      for (const table of ["event_documents", "event_change_requests"]) {
        expect(await visible(who.coordinatorA, eventA, table)).toBe(1);
        expect(await visible(who.organiserA, eventA, table)).toBe(1);
        for (const other of [who.coordinatorB, who.organiserB, who.attendee, who.venueStaff, who.technicalSupport]) {
          expect(await visible(other, eventA, table)).toBe(0);
        }
      }
    });

    it("SCRUM-91 nobody writes sessions or documents through the API yet (change requests: SCRUM-66, eventChangeRequestRls.test.ts)", async () => {
      const attempts = [
        who.coordinatorA.client.from("event_documents").insert({ event_id: eventA, file_name: "x", file_url: "x" }),
        who.coordinatorA.client
          .from("event_sessions")
          .insert({ event_id: eventA, session_name: "x", session_date: "2031-06-15", start_time: "09:00", end_time: "10:00", sequence_no: 9 }),
      ];
      for (const attempt of attempts) expect((await attempt).error?.code).toBe(DENIED);
    });
  });
});
