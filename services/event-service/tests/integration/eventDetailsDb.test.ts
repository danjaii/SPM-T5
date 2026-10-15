import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-111 against Postgres (migration 34): update_event_details() saves an edit and its history row together, only for
 * the event's current coordinator; event_change_history can be read by the event's coordinator and organiser only, and
 * written by nobody directly. docs/specs/edit-event-details.md. Fixtures are made with the secret key, named "IT-111-",
 * dated 2031 and removed afterwards (the history rows go with their event).
 */

const EMAILS = {
  coordinator: "rachel.tan@connectsphere.example.com", // the events' coordinator
  otherCoordinator: "marcus.lim@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com", // the events' organiser
  otherOrganiser: "adrian.foo@meridiancapital.example.com",
  attendee: "alicia.fernandez@example.com",
};

const DENIED = "42501";
const STALE = "CS111";
const LOCKED = "CS112";

describe.skipIf(!hasDb)("SCRUM-111 edit event details (migration 34)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS, Actor>;
  const eventIds: string[] = [];

  beforeAll(async () => {
    for (const [key, email] of Object.entries(EMAILS)) who[key as keyof typeof EMAILS] = await signInAs(email);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
  });

  /** An event of the organiser, assigned to `coordinator`, 120 people on 3 Mar 2031. */
  async function newEvent(fields: Record<string, unknown> = {}, coordinator: Actor = who.coordinator): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-111-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: who.organiser.userId,
        assigned_coordinator_id: coordinator.userId,
        status: "planning",
        is_draft: false,
        expected_attendance: 120,
        preferred_start_datetime: "2031-03-03T01:00:00+00:00",
        preferred_end_datetime: "2031-03-03T09:00:00+00:00",
        ...fields,
      })
      .select("id, name")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  const eventRow = async (id: string) => (await admin.from("events").select("*").eq("id", id).single()).data as Record<string, unknown>;
  const historyOf = async (id: string) => (await admin.from("event_change_history").select("*").eq("event_id", id)).data ?? [];

  const save = (actor: Actor, eventId: string, changes: Record<string, { from: unknown; to: unknown }>) =>
    actor.client.rpc("update_event_details", { p_event_id: eventId, p_changes: changes });

  // ----------------------------------------------------------------------------
  // AC1, AC4: the edit and its history row, together
  // ----------------------------------------------------------------------------

  it("111-S11: saves the changed fields and one history row with who, when, what and whether it was important", async () => {
    const id = await newEvent();
    const { name } = await eventRow(id);

    const { error } = await save(who.coordinator, id, { name: { from: name, to: "IT-111 Renamed" }, expected_attendance: { from: 120, to: 150 } });

    expect(error).toBeNull();
    expect(await eventRow(id)).toMatchObject({ name: "IT-111 Renamed", expected_attendance: 150 });
    const history = await historyOf(id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      changed_by: who.coordinator.userId,
      is_important: true,
      changes: { name: { from: name, to: "IT-111 Renamed" }, expected_attendance: { from: 120, to: 150 } },
    });
    expect(new Date(history[0].changed_at as string).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  // events had no venue requirements column before migration 34
  it("111-S11: venue requirements, dates and times, layout and the text fields can all be saved", async () => {
    const id = await newEvent();

    const { error } = await save(
      who.coordinator,
      id,
      {
        venue_requirements: { from: null, to: "Stage and lift" },
        accessibility_requirements: { from: null, to: "Hearing loop" },
        preferred_start_datetime: { from: "2031-03-03T01:00:00.000Z", to: "2031-03-04T01:00:00.000Z" },
        preferred_end_datetime: { from: "2031-03-03T09:00:00.000Z", to: "2031-03-04T09:00:00.000Z" },
      },
    );

    expect(error).toBeNull();
    const row = await eventRow(id);
    expect(row).toMatchObject({ venue_requirements: "Stage and lift", accessibility_requirements: "Hearing loop" });
    expect(new Date(row.preferred_start_datetime as string).toISOString()).toBe("2031-03-04T01:00:00.000Z");
  });

  // ----------------------------------------------------------------------------
  // The function's own checks, so calling it directly can't get round the service
  // ----------------------------------------------------------------------------

  it("111-S12: a 'from' that is no longer the event's value (changed meanwhile) is refused, and nothing is saved", async () => {
    const id = await newEvent();

    const { error } = await save(who.coordinator, id, { expected_attendance: { from: 99, to: 150 } });

    expect(error?.code).toBe(STALE);
    expect((await eventRow(id)).expected_attendance).toBe(120);
    expect(await historyOf(id)).toEqual([]);
  });

  it("111-S19: another coordinator calling it directly is refused, and nothing is saved", async () => {
    const id = await newEvent();

    const { error } = await save(who.otherCoordinator, id, { expected_attendance: { from: 120, to: 150 } });

    expect(error?.code).toBe(DENIED);
    expect((await eventRow(id)).expected_attendance).toBe(120);
    expect(await historyOf(id)).toEqual([]);
  });

  it("111-S19: the organiser, or an attendee, calling it directly is refused", async () => {
    const id = await newEvent();

    for (const actor of [who.organiser, who.attendee]) {
      expect((await save(actor, id, { purpose: { from: null, to: "x" } })).error?.code).toBe(DENIED);
    }
  });

  it("111-S18: the coordinator the event was moved away from is refused", async () => {
    const id = await newEvent({}, who.otherCoordinator);

    expect((await save(who.coordinator, id, { purpose: { from: null, to: "x" } })).error?.code).toBe(DENIED);
  });

  it.each(["completed", "cancelled", "rejected"])("111-S16: a %s event is refused, and nothing is saved", async (status) => {
    const id = await newEvent({ status });

    const { error } = await save(who.coordinator, id, { purpose: { from: null, to: "x" } });

    expect(error?.code).toBe(LOCKED);
    expect((await eventRow(id)).purpose).toBeNull();
  });

  // only the editable fields: not the status, the coordinator, the organiser or anything else
  it.each(["status", "assigned_coordinator_id", "organiser_id", "registration_capacity"])(
    "111-S19: a change to %s is refused, and nothing is saved",
    async (field) => {
      const id = await newEvent();

      const { error } = await save(who.coordinator, id, { [field]: { from: null, to: "x" } });

      expect(error?.code).toBe("22023");
      expect((await eventRow(id)).status).toBe("planning");
    },
  );

  it("111-S9: an unknown category is refused by its foreign key (23503)", async () => {
    const id = await newEvent();

    const { error } = await save(who.coordinator, id, { event_category_id: { from: null, to: "00000000-0000-0000-0000-000000000000" } });

    expect(error?.code).toBe("23503");
    expect(error?.message).toContain("event_category_id");
  });

  // ----------------------------------------------------------------------------
  // AC4: who can read the history, and that nobody writes it directly
  // ----------------------------------------------------------------------------

  it("111-S13, S14: the event's coordinator and organiser can read its history; another coordinator, organiser or an attendee can't", async () => {
    const id = await newEvent();
    await save(who.coordinator, id, { purpose: { from: null, to: "Learning" } });

    const rowsFor = async (actor: Actor) => (await actor.client.from("event_change_history").select("id").eq("event_id", id)).data ?? [];

    expect(await rowsFor(who.coordinator)).toHaveLength(1);
    expect(await rowsFor(who.organiser)).toHaveLength(1);
    expect(await rowsFor(who.otherCoordinator)).toEqual([]);
    expect(await rowsFor(who.otherOrganiser)).toEqual([]);
    expect(await rowsFor(who.attendee)).toEqual([]);
  });

  it("111-S11: nobody can write a history row, or change one, directly", async () => {
    const id = await newEvent();
    await save(who.coordinator, id, { purpose: { from: null, to: "Learning" } });
    const [row] = await historyOf(id);

    const insert = await who.coordinator.client
      .from("event_change_history")
      .insert({ event_id: id, changed_by: who.coordinator.userId, changes: {}, is_important: false });
    expect(insert.error).not.toBeNull();

    await who.coordinator.client.from("event_change_history").update({ is_important: true }).eq("id", row.id);
    await who.coordinator.client.from("event_change_history").delete().eq("id", row.id);
    expect(await historyOf(id)).toEqual([expect.objectContaining({ id: row.id, is_important: false })]);
  });
});
// end of SCRUM-111 against Postgres
