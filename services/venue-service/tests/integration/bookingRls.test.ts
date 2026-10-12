import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, DB_ENV, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * Per-role RLS on venue_bookings (migration 07). Every check signs in as a seeded user, so it goes
 * through the same JWT + publishable-key path the services use. Fixtures are created with the
 * secret key (which bypasses RLS) and are prefixed "IT-", dated 2030 and cleaned up afterwards.
 */
const EMAILS = {
  coordinatorA: "rachel.tan@connectsphere.example.com",
  coordinatorB: "marcus.lim@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  technicalSupport: "aaron.koh@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
  organiserA: "jason.chua@techconnect.example.com",
  organiserB: "weiling.ong@techconnect.example.com",
};

type Actor = { client: SupabaseClient; userId: string };

/** Postgres "insufficient_privilege": an RLS WITH CHECK failure or a missing column/table grant. */
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-33/SCRUM-32/SCRUM-35 venue_bookings row level security (migration 07)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  // Event A: coordinator A, organiser A. Event B: coordinator B, organiser B.
  let eventA: string;
  let bookingA: string;
  let bookingB: string;

  /**
   * A booking created with the secret key, so RLS never gets in the way of arranging it. Each one
   * gets its own event and venue: an event may hold only one active request (DR6) and a venue slot
   * only one holder (DR5).
   */
  async function arrange(side: "A" | "B", status = "requested"): Promise<{ id: string; eventId: string }> {
    const coordinator = who[`coordinator${side}`].userId;
    const eventId = await fixtures.event("approved", coordinator, who[`organiser${side}`].userId);
    const { data, error } = await admin
      .from("venue_bookings")
      .insert({
        event_id: eventId,
        venue_id: await fixtures.venue(),
        requested_by: coordinator,
        status,
        event_start_datetime: "2030-10-01T01:00:00Z",
        event_end_datetime: "2030-10-01T09:00:00Z",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id as string, eventId };
  }

  async function statusOf(id: string): Promise<string | undefined> {
    const { data } = await admin.from("venue_bookings").select("status").eq("id", id).maybeSingle();
    return data?.status as string | undefined;
  }

  async function visibleIds(actor: Actor, ids: string[]): Promise<string[]> {
    const { data, error } = await actor.client.from("venue_bookings").select("id").in("id", ids);
    expect(error).toBeNull();
    return (data ?? []).map((r) => r.id as string).sort();
  }

  beforeAll(async () => {
    if (!DB_ENV.publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY must be set for the RLS tests (see README).");
    for (const [key, email] of Object.entries(EMAILS)) who[key as keyof typeof EMAILS] = await signInAs(email);

    ({ id: bookingA, eventId: eventA } = await arrange("A"));
    ({ id: bookingB } =await arrange("B"));
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("reading", () => {
    it("33-S3 a coordinator who is not assigned reads none of another coordinator's requests", async () => {
      expect(await visibleIds(who.coordinatorB, [bookingA])).toEqual([]);
      const { data } = await who.coordinatorB.client.from("venue_bookings").select("id").eq("event_id", eventA);
      expect(data).toEqual([]);
    });

    it("33-S1 the assigned coordinator reads the requests for their own events, and only those", async () => {
      expect(await visibleIds(who.coordinatorA, [bookingA, bookingB])).toEqual([bookingA]);
      expect(await visibleIds(who.coordinatorB, [bookingA, bookingB])).toEqual([bookingB]);
    });

    it("venue staff read every request", async () => {
      expect(await visibleIds(who.venueStaff, [bookingA, bookingB])).toEqual([bookingA, bookingB].sort());

      const { count: all } = await admin.from("venue_bookings").select("id", { count: "exact", head: true });
      const { count: seen } = await who.venueStaff.client.from("venue_bookings").select("id", { count: "exact", head: true });
      expect(seen).toBe(all);
    });

    // Migration 08 (39-S7): the rejection reason is for Venue Staff and the assigned Coordinator only.
    it("39-S7 an organiser reads no requests, even for events they organise", async () => {
      expect(await visibleIds(who.organiserA, [bookingA, bookingB])).toEqual([]);
      expect(await visibleIds(who.organiserB, [bookingA, bookingB])).toEqual([]);
      const { data, error } = await who.organiserA.client.from("venue_bookings").select("id, review_notes").eq("event_id", eventA);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it.each(["technicalSupport", "attendee"] as const)("%s reads no requests at all", async (role) => {
      expect(await visibleIds(who[role], [bookingA, bookingB])).toEqual([]);
      // The seed has 17 bookings, so an unfiltered read returning nothing shows the table is closed.
      const { data, error } = await who[role].client.from("venue_bookings").select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("a request row is not exposed through a join to someone who cannot see it", async () => {
      const { data } = await who.attendee.client.from("events").select("id, venue_bookings(id)").eq("id", eventA);
      expect(data?.flatMap((e) => e.venue_bookings ?? [])).toEqual([]);
    });
  });

  describe("submitting", () => {
    const request = (eventId: string, venueId: string, requestedBy: string, extra: Record<string, unknown> = {}) => ({
      event_id: eventId,
      venue_id: venueId,
      requested_by: requestedBy,
      status: "requested",
      event_start_datetime: "2030-10-02T01:00:00Z",
      event_end_datetime: "2030-10-02T09:00:00Z",
      ...extra,
    });

    it("32-S4 a coordinator who is not assigned to the event cannot create a request for it", async () => {
      const event = await fixtures.event("approved", who.coordinatorA.userId, who.organiserA.userId);
      const { error } = await who.coordinatorB.client
        .from("venue_bookings")
        .insert(request(event, await fixtures.venue(), who.coordinatorB.userId));
      expect(error?.code).toBe(DENIED);

      const { count } = await admin.from("venue_bookings").select("id", { count: "exact", head: true }).eq("event_id", event);
      expect(count).toBe(0);
    });

    it.each(["organiserA", "venueStaff", "technicalSupport", "attendee"] as const)(
      "32-S4 %s cannot create a request",
      async (role) => {
        const event = await fixtures.event("approved", who.coordinatorA.userId, who.organiserA.userId);
        const { error } = await who[role].client
          .from("venue_bookings")
          .insert(request(event, await fixtures.venue(), who[role].userId));
        expect(error?.code).toBe(DENIED);
      },
    );

    it("32-S1 the assigned coordinator can create a pending request in their own name", async () => {
      const event = await fixtures.event("approved", who.coordinatorA.userId, who.organiserA.userId);
      const { data, error } = await who.coordinatorA.client
        .from("venue_bookings")
        .insert(request(event, await fixtures.venue(), who.coordinatorA.userId))
        .select("id, status, requested_by")
        .single();
      expect(error).toBeNull();
      expect(data).toMatchObject({ status: "requested", requested_by: who.coordinatorA.userId });
    });

    it("32-S4 the assigned coordinator cannot file a request as someone else or already approved", async () => {
      const event = await fixtures.event("approved", who.coordinatorA.userId, who.organiserA.userId);
      const impersonated = await who.coordinatorA.client
        .from("venue_bookings")
        .insert(request(event, await fixtures.venue(), who.coordinatorB.userId));
      expect(impersonated.error?.code).toBe(DENIED);

      const preApproved = await who.coordinatorA.client
        .from("venue_bookings")
        .insert(request(event, await fixtures.venue(), who.coordinatorA.userId, { status: "approved" }));
      expect(preApproved.error?.code).toBe(DENIED);
    });
  });

  describe("withdrawing and deciding", () => {
    const withdrawal = (userId: string) => ({ status: "withdrawn", withdrawn_by: userId, withdrawn_at: new Date().toISOString() });
    const decision = (status: "approved" | "rejected", userId: string) => ({
      status,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      review_notes: status === "rejected" ? "Room under maintenance" : null,
    });

    it("35-S1 the assigned coordinator can withdraw their own pending request", async () => {
      const { id } = await arrange("A");
      const { data, error } = await who.coordinatorA.client
        .from("venue_bookings")
        .update(withdrawal(who.coordinatorA.userId))
        .eq("id", id)
        .select("id, status, withdrawn_by");
      expect(error).toBeNull();
      expect(data).toEqual([{ id, status: "withdrawn", withdrawn_by: who.coordinatorA.userId }]);
    });

    it("35-S3 another coordinator cannot withdraw it: the row is invisible to them, so nothing changes", async () => {
      const { id } = await arrange("A");
      const { data, error } = await who.coordinatorB.client
        .from("venue_bookings")
        .update(withdrawal(who.coordinatorB.userId))
        .eq("id", id)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);
      expect(await statusOf(id)).toBe("requested");
    });

    it("35-S3 an organiser cannot withdraw it", async () => {
      const { id } = await arrange("A");
      const { data } = await who.organiserA.client
        .from("venue_bookings")
        .update(withdrawal(who.organiserA.userId))
        .eq("id", id)
        .select("id");
      expect(data).toEqual([]);
      expect(await statusOf(id)).toBe("requested");
    });

    it("the coordinator cannot approve or reject their own request", async () => {
      for (const status of ["approved", "rejected"] as const) {
        const { id } = await arrange("A");
        const { error } = await who.coordinatorA.client
          .from("venue_bookings")
          .update(decision(status, who.coordinatorA.userId))
          .eq("id", id);
        expect(error?.code).toBe(DENIED);
        expect(await statusOf(id)).toBe("requested");
      }
    });

    it("the coordinator cannot use a withdrawal to move the request to another venue or time", async () => {
      const { id } = await arrange("A");
      const { error } = await who.coordinatorA.client
        .from("venue_bookings")
        .update({ ...withdrawal(who.coordinatorA.userId), venue_id: await fixtures.venue() })
        .eq("id", id);
      expect(error?.code).toBe(DENIED);
      expect(await statusOf(id)).toBe("requested");
    });

    it("35-S2 the coordinator cannot update a request that has already been decided or withdrawn", async () => {
      for (const decided of ["approved", "rejected", "withdrawn"]) {
        const { id } = await arrange("A", decided);
        const { data, error } = await who.coordinatorA.client
          .from("venue_bookings")
          .update(withdrawal(who.coordinatorA.userId))
          .eq("id", id)
          .select("id");
        expect(error).toBeNull();
        expect(data, decided).toEqual([]);
        expect(await statusOf(id)).toBe(decided);
      }
    });

    it("venue staff can approve a pending request", async () => {
      const { id } = await arrange("A");
      const { data, error } = await who.venueStaff.client
        .from("venue_bookings")
        .update(decision("approved", who.venueStaff.userId))
        .eq("id", id)
        .select("status, reviewed_by");
      expect(error).toBeNull();
      expect(data).toEqual([{ status: "approved", reviewed_by: who.venueStaff.userId }]);
    });

    it("venue staff can reject a pending request with a reason", async () => {
      const { id } = await arrange("A");
      const { data, error } = await who.venueStaff.client
        .from("venue_bookings")
        .update(decision("rejected", who.venueStaff.userId))
        .eq("id", id)
        .select("status, review_notes");
      expect(error).toBeNull();
      expect(data).toEqual([{ status: "rejected", review_notes: "Room under maintenance" }]);
    });

    it("venue staff cannot record a decision under someone else's name, and cannot re-decide a decided request", async () => {
      const { id: pending } = await arrange("A");
      const forged = await who.venueStaff.client
        .from("venue_bookings")
        .update(decision("approved", who.coordinatorA.userId))
        .eq("id", pending);
      expect(forged.error?.code).toBe(DENIED);
      expect(await statusOf(pending)).toBe("requested");

      const { id: decided } = await arrange("A", "approved");
      const { data } = await who.venueStaff.client
        .from("venue_bookings")
        .update(decision("rejected", who.venueStaff.userId))
        .eq("id", decided)
        .select("id");
      expect(data).toEqual([]);
      expect(await statusOf(decided)).toBe("approved");
    });

    it.each(["technicalSupport", "attendee", "organiserA"] as const)("%s cannot decide a request", async (role) => {
      const { id } = await arrange("A");
      const { data } = await who[role].client
        .from("venue_bookings")
        .update(decision("approved", who[role].userId))
        .eq("id", id)
        .select("id");
      expect(data ?? []).toEqual([]);
      expect(await statusOf(id)).toBe("requested");
    });
  });

  describe("deleting", () => {
    it.each(["coordinatorA", "venueStaff", "organiserA"] as const)("%s cannot delete a request through the API", async (role) => {
      const { id } = await arrange("A");
      await who[role].client.from("venue_bookings").delete().eq("id", id);
      expect(await statusOf(id)).toBe("requested");
    });
  });

  describe("slot pre-check", () => {
    it("36-S1 a coordinator can ask whether a slot is held even when the holder is another coordinator's", async () => {
      const venue = await fixtures.venue();
      const { error } = await admin.from("venue_bookings").insert({
        event_id: await fixtures.event("approved", who.coordinatorA.userId, who.organiserA.userId),
        venue_id: venue,
        requested_by: who.coordinatorA.userId,
        status: "requested",
        event_start_datetime: "2030-10-03T01:00:00Z",
        event_end_datetime: "2030-10-03T09:00:00Z",
      });
      expect(error).toBeNull();

      const held = (start: string, end: string) =>
        who.coordinatorB.client.rpc("venue_slot_is_held", { p_venue_id: venue, p_start: start, p_end: end });

      // Coordinator B cannot read the row, but still learns the slot is taken.
      expect(await visibleIds(who.coordinatorB, [bookingA])).toEqual([]);
      expect((await held("2030-10-03T05:00:00Z", "2030-10-03T12:00:00Z")).data).toBe(true);
      // Back-to-back is free (half-open periods).
      expect((await held("2030-10-03T09:00:00Z", "2030-10-03T12:00:00Z")).data).toBe(false);
      expect((await held("2030-10-04T01:00:00Z", "2030-10-04T09:00:00Z")).data).toBe(false);
    });
  });
});
