import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVENT_STATUSES, isClosedEventStatus } from "@spm-t5/shared";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-77: the unassigned queue is built by lead_unassigned_queue() (migration 21), called as the signed-in user so RLS
 * applies. Fixtures are made with the secret key, named "IT-77-", dated 2031 and removed afterwards; the seeded events
 * are in the queue too, so these tests only look at their own fixtures.
 */
const EMAILS = {
  leadA: "helen.ong@connectsphere.example.com",
  leadB: "samuel.tay@connectsphere.example.com",
  coordinator: "siti.aminah@connectsphere.example.com", // not linked to any Lead
  venueStaff: "kenneth.wong@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
  attendee: "alicia.fernandez@example.com",
};

const DENIED = "42501";

type QueueRow = {
  id: string;
  name: string;
  organiser_name: string;
  preferred_start_datetime: string;
  preferred_end_datetime: string;
  expected_attendance: number;
  submitted_at: string;
};

describe.skipIf(!hasDb)("SCRUM-77 unassigned event queue (migration 21)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];
  const ids = {} as Record<string, string>;

  async function newEvent(key: string, fields: Record<string, unknown>) {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-77-${key}`,
        organiser_id: who.organiser.userId,
        status: "submitted",
        is_draft: false,
        preferred_start_datetime: "2031-06-15T01:00:00Z",
        preferred_end_datetime: "2031-06-15T09:00:00Z",
        expected_attendance: 80,
        submitted_at: "2031-01-01T00:00:00Z",
        ...fields,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    ids[key] = data.id as string;
  }

  const queueAs = async (actor: Actor) => {
    const { data, error } = await actor.client.rpc("lead_unassigned_queue");
    return { rows: (data ?? []) as QueueRow[], error };
  };

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    // Submitted out of order on purpose, so the queue has to sort them
    await newEvent("second", { submitted_at: "2031-01-02T08:00:00Z" });
    await newEvent("first", { submitted_at: "2031-01-01T08:00:00Z", expected_attendance: 120 });
    await newEvent("third", { submitted_at: "2031-01-02T09:30:00Z" });
    await newEvent("underReview", { status: "under_review" });
    await newEvent("returned", { status: "returned" });
    await newEvent("assigned", { assigned_coordinator_id: who.coordinator.userId });
    await newEvent("draft", { status: "draft", is_draft: true, submitted_at: null });
    for (const status of ["completed", "cancelled", "rejected"]) await newEvent(status, { status });
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
  });

  // AC1: a submitted, non-closed request with no coordinator is in the queue (any non-draft status counts as submitted)
  it.each(["first", "second", "third", "underReview", "returned"])("SCRUM-77/AC1 shows the unassigned request %s", async (key) => {
    const { rows, error } = await queueAs(who.leadA);
    expect(error).toBeNull();
    expect(rows.map((r) => r.id)).toContain(ids[key]);
  });

  // Only this suite's fixtures: other suites add and assign events in parallel, so the whole queue can change between reads
  it("SCRUM-77/AC1 every Lead sees the same shared queue (BR4)", async () => {
    const mine = (rows: QueueRow[]) => rows.map((r) => r.id).filter((id) => eventIds.includes(id));
    const a = mine((await queueAs(who.leadA)).rows);
    const b = mine((await queueAs(who.leadB)).rows);
    expect(a).toHaveLength(5);
    expect(b).toEqual(a);
  });
  // end of AC1

  // AC2: name, Event Organiser, preferred date and time, expected attendance, submission date
  it("SCRUM-77/AC2 shows each request's name, organiser, preferred date and time, attendance and submission date", async () => {
    const { rows } = await queueAs(who.leadA);
    const first = rows.find((r) => r.id === ids.first);

    expect(first).toEqual({
      id: ids.first,
      name: "IT-77-first",
      organiser_name: "Jason Chua",
      preferred_start_datetime: "2031-06-15T01:00:00+00:00",
      preferred_end_datetime: "2031-06-15T09:00:00+00:00",
      expected_attendance: 120,
      submitted_at: "2031-01-01T08:00:00+00:00",
    });
  });
  // end of AC2

  // AC3: oldest to newest by submission date and time
  it("SCRUM-77/AC3 lists requests oldest to newest by submission date and time", async () => {
    const { rows } = await queueAs(who.leadA);
    const order = rows.map((r) => r.id).filter((id) => [ids.first, ids.second, ids.third].includes(id));
    expect(order).toEqual([ids.first, ids.second, ids.third]);

    const times = rows.map((r) => r.submitted_at).filter(Boolean).map((t) => new Date(t).getTime());
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });
  // end of AC3

  // AC4: a request with a coordinator is not in the queue
  it("SCRUM-77/AC4 does not show a request that already has a coordinator", async () => {
    const { rows } = await queueAs(who.leadA);
    expect(rows.map((r) => r.id)).not.toContain(ids.assigned);
  });
  // end of AC4

  // AC5: a closed request is not in the queue, even with no coordinator; nor is a draft (never submitted)
  it.each(["completed", "cancelled", "rejected", "draft"])("SCRUM-77/AC5 does not show an unassigned %s request", async (key) => {
    const { rows } = await queueAs(who.leadA);
    expect(rows.map((r) => r.id)).not.toContain(ids[key]);
  });

  // The database's idea of "closed" is the shared one, for every status there is
  it.each(EVENT_STATUSES)("SCRUM-77/AC5 the database and the app agree whether %s is closed", async (status) => {
    const { data, error } = await who.leadA.client.rpc("is_closed_event_status", { p_status: status });
    expect(error).toBeNull();
    expect(data).toBe(isClosedEventStatus(status));
  });
  // end of AC5

  // AC7: anyone but a Lead is refused at the database, whichever way they call it
  it.each(["coordinator", "venueStaff", "organiser", "attendee"] as const)(
    "SCRUM-77/AC7 refuses the queue to a %s calling the database directly",
    async (actor) => {
      const { rows, error } = await queueAs(who[actor]);
      expect(error?.code).toBe(DENIED);
      expect(rows).toEqual([]);
    },
  );

  it("SCRUM-77/AC7 a Lead reads unassigned submitted requests directly, but not drafts or events assigned to a coordinator who isn't theirs", async () => {
    const { data } = await who.leadA.client.from("events").select("id").in("id", [ids.first, ids.draft, ids.assigned]);
    expect((data ?? []).map((r) => r.id)).toEqual([ids.first]);
  });
  // end of AC7
});
