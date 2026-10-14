import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOSED_EVENT_STATUSES } from "@spm-t5/shared";
import { adminClient, hasDb, SEED_PASSWORD, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-79: a Lead reassigns a non-closed event held by one of their coordinators to another of their coordinators,
 * through lead_reassign_coordinator() (migration 24). Since then only a Lead changes an event's coordinator: the
 * events_assignment_guard trigger refuses everyone else, whichever way they call the database (replaces SCRUM-41).
 * Fixtures are made with the secret key, named "IT-79-", dated 2031 and removed afterwards.
 */

/** Seeded accounts this suite only reads with, or refuses: it never assigns to them. */
const EMAILS = {
  seededCoordinator: "rachel.tan@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
};

/**
 * Accounts made for this suite, so its reassignments never change the seeded Leads' workloads, which other suites count
 * while this one runs. Lead A supervises coordA1 and coordA2; Lead B supervises only coordB.
 */
const MADE = ["leadA", "leadB", "coordA1", "coordA2", "coordB"] as const;

const DENIED = "42501";
const CLOSED = "CL001";
const NOT_ELIGIBLE = "CL003";
const NOT_ASSIGNED = "CL004"; // nothing to reassign yet: that's an assignment (SCRUM-78)
const NOT_YOUR_TEAM = "CL005"; // held by a coordinator another Lead supervises (BR4)
const SAME_COORDINATOR = "CL006"; // the current coordinator can't be chosen (AC2)
const NOT_FOUND = "P0002";

describe.skipIf(!hasDb)("SCRUM-79 Lead reassigns an Event Coordinator (migration 24)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS | (typeof MADE)[number], Actor>;
  const eventIds: string[] = [];
  const madeUsers: string[] = [];

  async function newAccount(key: (typeof MADE)[number], role: string, lead: Actor | null) {
    const email = `it-79-${key.toLowerCase()}-${randomUUID().slice(0, 8)}@connectsphere.example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    madeUsers.push(data.user.id);
    const profile = await admin.from("users").insert({
      id: data.user.id,
      role,
      full_name: `IT-79 ${key}`,
      email,
      supervising_lead_id: lead?.userId ?? null,
    });
    if (profile.error) throw new Error(profile.error.message);
    who[key] = await signInAs(email);
  }

  /** An event already assigned to `coordinator` (by the secret key, as if a Lead had assigned it). */
  async function newEvent(coordinator: Actor | null, fields: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-79-${randomUUID().slice(0, 8)}`,
        organiser_id: who.organiser.userId,
        assigned_coordinator_id: coordinator?.userId ?? null,
        status: "planning",
        is_draft: false,
        preferred_start_datetime: "2031-09-01T02:00:00Z",
        preferred_end_datetime: "2031-09-01T06:00:00Z",
        expected_attendance: 70,
        submitted_at: "2031-01-01T00:00:00Z",
        ...fields,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  const reassignAs = (actor: Actor, eventId: string, coordinatorId: string) =>
    actor.client.rpc("lead_reassign_coordinator", { p_event_id: eventId, p_coordinator_id: coordinatorId });

  const assignedTo = async (eventId: string) =>
    (await admin.from("events").select("assigned_coordinator_id").eq("id", eventId).single()).data?.assigned_coordinator_id as string | null;

  const logsFor = async (eventId: string) =>
    (await admin.from("coordinator_assignment_logs").select("coordinator_id, previous_coordinator_id, assigned_by, assigned_at").eq("event_id", eventId)).data ?? [];

  /** Expect a refused call, with the assignment unchanged and nothing recorded. */
  async function expectRefused(call: PromiseLike<{ error: { code?: string } | null }>, code: string, eventId: string, holder: string | null) {
    const { error } = await call;
    expect(error?.code).toBe(code);
    expect(await assignedTo(eventId)).toBe(holder);
    expect(await logsFor(eventId)).toEqual([]);
  }

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    await newAccount("leadA", "event_coordinator_lead", null);
    await newAccount("leadB", "event_coordinator_lead", null);
    await newAccount("coordA1", "event_coordinator", who.leadA);
    await newAccount("coordA2", "event_coordinator", who.leadA);
    await newAccount("coordB", "event_coordinator", who.leadB);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // cascades the logs
    if (madeUsers.length > 0) await admin.from("users").update({ supervising_lead_id: null }).in("id", madeUsers);
    for (const id of madeUsers) await admin.auth.admin.deleteUser(id);
  });

  // AC3: the new coordinator becomes the only assigned coordinator; the previous one no longer is
  it("SCRUM-79/AC3 reassigns the event to the chosen coordinator, replacing the previous one", async () => {
    const eventId = await newEvent(who.coordA1);

    const { error } = await reassignAs(who.leadA, eventId, who.coordA2.userId);

    expect(error).toBeNull();
    expect(await assignedTo(eventId)).toBe(who.coordA2.userId);
  });
  // end of AC3

  // AC4: each coordinator's own view of their events follows the change
  it("SCRUM-79/AC4 the previous coordinator no longer sees the event as theirs; the new coordinator does", async () => {
    const eventId = await newEvent(who.coordA1);
    const mine = async (coordinator: Actor) =>
      ((await coordinator.client.from("events").select("id").eq("assigned_coordinator_id", coordinator.userId)).data ?? []).map((r) => r.id);
    expect(await mine(who.coordA1)).toContain(eventId);

    await reassignAs(who.leadA, eventId, who.coordA2.userId);

    expect(await mine(who.coordA1)).not.toContain(eventId);
    expect(await mine(who.coordA2)).toContain(eventId);
  });
  // end of AC4

  // AC5 / BR2: a closed event cannot be reassigned
  it.each(CLOSED_EVENT_STATUSES)("SCRUM-79/AC5 refuses to reassign a %s event", async (status) => {
    const eventId = await newEvent(who.coordA1, { status });
    await expectRefused(reassignAs(who.leadA, eventId, who.coordA2.userId), CLOSED, eventId, who.coordA1.userId);
  });
  // end of AC5

  // AC2 + AC6: the current coordinator can't be chosen, so with no one else there is nobody to reassign to
  it("SCRUM-79/AC6 a Lead whose only coordinator is the current one cannot reassign, and the assignment is unchanged", async () => {
    const eventId = await newEvent(who.coordB);
    const choices = ((await who.leadB.client.rpc("lead_coordinator_overview")).data as { id: string }[]).map((c) => c.id);
    expect(choices).toEqual([who.coordB.userId]);

    await expectRefused(reassignAs(who.leadB, eventId, who.coordB.userId), SAME_COORDINATOR, eventId, who.coordB.userId);
  });

  it.each(["coordB", "seededCoordinator", "venueStaff", "leadB"] as const)(
    "SCRUM-79/AC6 refuses to reassign to %s, who is not one of the Lead's active coordinators",
    async (target) => {
      const eventId = await newEvent(who.coordA1);
      await expectRefused(reassignAs(who.leadA, eventId, who[target].userId), NOT_ELIGIBLE, eventId, who.coordA1.userId);
    },
  );
  // end of AC6

  // AC8: who was replaced, by whom, which Lead did it, and when
  it("SCRUM-79/AC8 records the previous coordinator, the new coordinator, the Lead and the date and time", async () => {
    const eventId = await newEvent(who.coordA1);
    const before = Date.now();

    await reassignAs(who.leadA, eventId, who.coordA2.userId);

    const logs = await logsFor(eventId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      coordinator_id: who.coordA2.userId,
      previous_coordinator_id: who.coordA1.userId,
      assigned_by: who.leadA.userId,
    });
    const at = new Date(logs[0].assigned_at as string).getTime();
    expect(at).toBeGreaterThanOrEqual(before - 5_000); // database and test clocks may differ slightly
    expect(at).toBeLessThanOrEqual(Date.now() + 5_000);
  });
  // end of AC8

  // AC9: nobody but a Lead can reassign, by any route into the database, and nothing changes
  it.each(["coordA1", "seededCoordinator", "venueStaff", "organiser"] as const)(
    "SCRUM-79/AC9 refuses lead_reassign_coordinator to a %s",
    async (actor) => {
      const eventId = await newEvent(who.coordA1);
      await expectRefused(reassignAs(who[actor], eventId, who.coordA2.userId), DENIED, eventId, who.coordA1.userId);
    },
  );

  it("SCRUM-79/AC9 the assigned coordinator can no longer hand the event over by updating it directly", async () => {
    const eventId = await newEvent(who.coordA1);
    await expectRefused(
      who.coordA1.client.from("events").update({ assigned_coordinator_id: who.coordA2.userId }).eq("id", eventId),
      DENIED,
      eventId,
      who.coordA1.userId,
    );
  });

  it("SCRUM-79/AC9 the assigned coordinator can no longer hand the event over through assign_coordinator()", async () => {
    const eventId = await newEvent(who.coordA1);
    await expectRefused(
      who.coordA1.client.rpc("assign_coordinator", { p_event_id: eventId, p_coordinator_id: who.coordA2.userId }),
      DENIED,
      eventId,
      who.coordA1.userId,
    );
  });
  // end of AC9

  // BR4: a Lead reassigns only events held by their own coordinators
  it("SCRUM-79/AC9 a Lead cannot reassign an event held by another Lead's coordinator", async () => {
    const eventId = await newEvent(who.coordB);
    await expectRefused(reassignAs(who.leadA, eventId, who.coordA1.userId), NOT_YOUR_TEAM, eventId, who.coordB.userId);
  });

  it("SCRUM-79 an event with no coordinator is assigned, not reassigned", async () => {
    const eventId = await newEvent(null, { status: "submitted" });
    await expectRefused(reassignAs(who.leadA, eventId, who.coordA1.userId), NOT_ASSIGNED, eventId, null);
  });

  it("SCRUM-79 refuses a missing event as not found", async () => {
    const { error } = await reassignAs(who.leadA, randomUUID(), who.coordA1.userId);
    expect(error?.code).toBe(NOT_FOUND);
  });
});
