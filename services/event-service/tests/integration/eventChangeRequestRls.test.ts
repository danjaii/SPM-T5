import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * Row level security for submitting an event change request (migration 14, SCRUM-66). Every check
 * signs in as a seeded user, so it goes through the same JWT + publishable-key path event-service
 * uses. Fixtures are created with the secret key (which bypasses RLS), prefixed "IT-" and removed
 * afterwards.
 */
const EMAILS = {
  organiserA: "jason.chua@techconnect.example.com",
  organiserB: "weiling.ong@techconnect.example.com",
  coordinator: "rachel.tan@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
};

/** Postgres "insufficient_privilege": an RLS WITH CHECK failure or a missing grant. */
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-66 event change request row level security (migration 14)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];

  async function newEvent(organiser: string, status: string): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-change-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: organiser,
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

  const request = (actor: Actor, eventId: string, overrides: Record<string, unknown> = {}) =>
    actor.client.from("event_change_requests").insert({
      event_id: eventId,
      requested_by: actor.userId,
      change_description: "IT change",
      proposed_changes: { expected_attendance: { from: 50, to: 80 } },
      ...overrides,
    });

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // change requests cascade
  });

  it.each(["submitted", "under_review", "approved", "confirmed"])(
    "SCRUM-66/AC1 an organiser can request a change to their own %s event, and the event stays unchanged (AC6)",
    async (status) => {
      const id = await newEvent(who.organiserA.userId, status);
      const { error } = await request(who.organiserA, id);
      expect(error).toBeNull();

      const stored = await admin.from("event_change_requests").select("status, requested_by").eq("event_id", id).single();
      expect(stored.data).toEqual({ status: "pending", requested_by: who.organiserA.userId });
      const event = await admin.from("events").select("status, expected_attendance").eq("id", id).single();
      expect(event.data).toEqual({ status, expected_attendance: 50 });
    },
  );

  it.each(["cancelled", "rejected", "completed"])(
    "SCRUM-66/AC2 an organiser cannot request a change to their own %s event",
    async (status) => {
      const id = await newEvent(who.organiserA.userId, status);
      expect((await request(who.organiserA, id)).error?.code).toBe(DENIED);
    },
  );

  it("SCRUM-66/AC3 an organiser cannot request a change to their own draft", async () => {
    const id = await newEvent(who.organiserA.userId, "draft");
    expect((await request(who.organiserA, id)).error?.code).toBe(DENIED);
  });

  it("SCRUM-66/AC1 only the event's own organiser can request a change", async () => {
    const id = await newEvent(who.organiserA.userId, "submitted");
    expect((await request(who.organiserB, id)).error?.code).toBe(DENIED);
    expect((await request(who.coordinator, id)).error?.code).toBe(DENIED);
    expect((await request(who.attendee, id)).error?.code).toBe(DENIED);
  });

  it("SCRUM-66/AC6 a request is in the caller's own name, and always starts pending and unreviewed", async () => {
    const id = await newEvent(who.organiserA.userId, "submitted");
    expect((await request(who.organiserA, id, { requested_by: who.organiserB.userId })).error?.code).toBe(DENIED);
    expect((await request(who.organiserA, id, { status: "approved" })).error?.code).toBe(DENIED);
    expect((await request(who.organiserA, id, { reviewed_by: who.coordinator.userId })).error?.code).toBe(DENIED);
  });

  it("SCRUM-66/AC7 the organiser and a coordinator can read the request's status; another organiser cannot", async () => {
    const id = await newEvent(who.organiserA.userId, "submitted");
    expect((await request(who.organiserA, id)).error).toBeNull();
    const read = async (actor: Actor) =>
      (await actor.client.from("event_change_requests").select("status").eq("event_id", id)).data ?? [];
    expect(await read(who.organiserA)).toEqual([{ status: "pending" }]);
    expect(await read(who.coordinator)).toEqual([{ status: "pending" }]);
    expect(await read(who.organiserB)).toEqual([]);
  });

  it("SCRUM-66/AC6 an organiser cannot edit, approve or delete a request", async () => {
    const id = await newEvent(who.organiserA.userId, "submitted");
    expect((await request(who.organiserA, id)).error).toBeNull();

    const update = await who.organiserA.client
      .from("event_change_requests")
      .update({ status: "approved" })
      .eq("event_id", id);
    expect(update.error?.code).toBe(DENIED);
    const remove = await who.organiserA.client.from("event_change_requests").delete().eq("event_id", id);
    expect(remove.error?.code).toBe(DENIED);

    const stored = await admin.from("event_change_requests").select("status").eq("event_id", id).single();
    expect(stored.data?.status).toBe("pending");
  });
});
