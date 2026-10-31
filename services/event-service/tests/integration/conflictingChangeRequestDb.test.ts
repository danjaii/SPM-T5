import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-176 against Postgres (docs/specs/conflicting-change-request.md, migration 67): a pending change request cannot be
 * joined by another that changes the same thing (start and end time count as one), even when the route's own check is
 * skipped or two arrive at once. Fixtures are made with the secret key, named "IT-176-", dated 2031 and removed afterwards;
 * every check reads only rows this file made (CLAUDE.md, SCRUM-143).
 */

type Row = Record<string, unknown>;

const ATTENDANCE = { expected_attendance: { from: 120, to: 150 } };
const START = { preferred_start_datetime: { from: "2031-03-03T01:00:00+00:00", to: "2031-03-04T01:00:00+00:00" } };
const END = { preferred_end_datetime: { from: "2031-03-03T09:00:00+00:00", to: "2031-03-04T09:00:00+00:00" } };
const VENUE = { venue_requirements: { from: null, to: "Theatre" } };

describe.skipIf(!hasDb)("SCRUM-176 conflicting change requests (migration 67)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  let organiser: Actor;
  const eventIds: string[] = [];

  beforeAll(async () => {
    organiser = await signInAs("jason.chua@techconnect.example.com");
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
  });

  /** A Planning event of Jason's, on 3 Mar 2031. */
  async function planningEvent(): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-176-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: organiser.userId,
        status: "planning",
        is_draft: false,
        expected_attendance: 120,
        preferred_start_datetime: "2031-03-03T01:00:00+00:00",
        preferred_end_datetime: "2031-03-03T09:00:00+00:00",
      })
      .select("id")
      .single();
    if (error) throw new Error(`events: ${error.message}`);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  /** A request already on the event (made with the secret key, as an earlier one would have been). */
  async function earlier(eventId: string, status: string, proposed: Row) {
    const { error } = await admin.from("event_change_requests").insert({
      event_id: eventId, requested_by: organiser.userId, change_description: "Earlier request", proposed_changes: proposed, status,
    });
    if (error) throw new Error(`event_change_requests: ${error.message}`);
  }

  /** What the route does: Jason inserts a pending request himself, so RLS and the database's checks apply. */
  const request = (eventId: string, proposed: Row) =>
    organiser.client.from("event_change_requests").insert({
      event_id: eventId, requested_by: organiser.userId, change_description: "New request", proposed_changes: proposed, status: "pending",
    });

  const pendingCount = async (eventId: string) =>
    ((await admin.from("event_change_requests").select("id").eq("event_id", eventId).eq("status", "pending")).data ?? []).length;

  it("176-S6 SCRUM-176/AC1 refuses a second pending attendance change (CS176); one stays pending", async () => {
    const eventId = await planningEvent();
    await earlier(eventId, "pending", ATTENDANCE);

    const { error } = await request(eventId, { expected_attendance: { from: 120, to: 180 } });

    expect(error?.code).toBe("CS176");
    expect(await pendingCount(eventId)).toBe(1);
  });

  it("176-S6 SCRUM-176/AC1 treats start and end time as one thing", async () => {
    const eventId = await planningEvent();
    await earlier(eventId, "pending", START);

    expect((await request(eventId, END)).error?.code).toBe("CS176");
  });

  it("176-S6 SCRUM-176/AC1 counts a seeded request that holds only the new value", async () => {
    const eventId = await planningEvent();
    await earlier(eventId, "pending", { expected_attendance: 220 });

    expect((await request(eventId, ATTENDANCE)).error?.code).toBe("CS176");
  });

  it("176-S4 SCRUM-176/AC2 accepts a request for something else while one is pending", async () => {
    const eventId = await planningEvent();
    await earlier(eventId, "pending", ATTENDANCE);

    expect((await request(eventId, VENUE)).error).toBeNull();
    expect(await pendingCount(eventId)).toBe(2);
  });

  it("176-S5 SCRUM-176/AC3 accepts a request for the same thing once the earlier ones are decided", async () => {
    const eventId = await planningEvent();
    await earlier(eventId, "approved", ATTENDANCE);
    await earlier(eventId, "rejected", ATTENDANCE);

    expect((await request(eventId, ATTENDANCE)).error).toBeNull();
  });

  it("176-S7 SCRUM-176/AC1 ignores a pending request on another event", async () => {
    const eventId = await planningEvent();
    const otherId = await planningEvent();
    await earlier(otherId, "pending", ATTENDANCE);

    expect((await request(eventId, ATTENDANCE)).error).toBeNull();
  });
});
