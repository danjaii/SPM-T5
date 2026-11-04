import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOSED_EVENT_STATUSES } from "@spm-t5/shared";
import { adminClient, hasDb, SEED_PASSWORD, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-78: a Lead assigns an unassigned event request to one of their coordinators, through lead_assign_coordinator()
 * (migration 23), and nobody else can make a first assignment (the events_assignment_guard trigger), whichever way they
 * call the database. Fixtures are made with the secret key, named "IT-78-", dated 2031 and removed afterwards.
 */

/** Seeded accounts this suite only reads with, or refuses: it never assigns to them. */
const EMAILS = {
  seededCoordinator: "rachel.tan@connectsphere.example.com",
  priya: "priya.nair@connectsphere.example.com", // Lead B (Samuel Tay)'s
  siti: "siti.aminah@connectsphere.example.com", // not linked
  venueStaff: "kenneth.wong@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
};

/**
 * Accounts made for this suite, so assigning events here never changes the seeded Leads' workloads, which other suites
 * count while this one runs. Lead A supervises coordA1, coordA2 and inactiveA (deactivated); Lead B supervises coordB.
 */
const MADE = ["leadA", "leadB", "coordA1", "coordA2", "inactiveA", "coordB", "loneLead"] as const;

const DENIED = "42501";
const CLOSED = "CL001"; // closed events can't be assigned (BR2)
const ALREADY_ASSIGNED = "CL002"; // someone else assigned it first (AC5)
const NOT_ELIGIBLE = "CL003"; // not an active coordinator linked to this Lead (BR4)
const NOT_FOUND = "P0002";

describe.skipIf(!hasDb)("SCRUM-78 Lead assigns an Event Coordinator (migration 23)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS | (typeof MADE)[number], Actor>;
  const eventIds: string[] = [];
  const madeUsers: string[] = [];

  async function newEvent(fields: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-78-${randomUUID().slice(0, 8)}`,
        organiser_id: who.organiser.userId,
        status: "submitted",
        is_draft: false,
        preferred_start_datetime: "2031-08-01T02:00:00Z",
        preferred_end_datetime: "2031-08-01T06:00:00Z",
        expected_attendance: 60,
        submitted_at: "2031-01-01T00:00:00Z",
        ...fields,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  const assignAs = (actor: Actor, eventId: string, coordinatorId: string) =>
    actor.client.rpc("lead_assign_coordinator", { p_event_id: eventId, p_coordinator_id: coordinatorId });

  const assignedTo = async (eventId: string) =>
    (await admin.from("events").select("assigned_coordinator_id").eq("id", eventId).single()).data?.assigned_coordinator_id as string | null;

  const logsFor = async (eventId: string) =>
    (await admin.from("coordinator_assignment_logs").select("coordinator_id, previous_coordinator_id, assigned_by").eq("event_id", eventId)).data ?? [];

  const workloadOf = async (lead: Actor, coordinatorId: string) =>
    ((await lead.client.rpc("lead_coordinator_overview")).data as { id: string; workload: number }[]).find((c) => c.id === coordinatorId)?.workload;

  /** Expect a refused call, with the event still unassigned and nothing recorded. */
  async function expectRefused(call: PromiseLike<{ error: { code?: string } | null }>, code: string, eventId: string) {
    const { error } = await call;
    expect(error?.code).toBe(code);
    expect(await assignedTo(eventId)).toBeNull();
    expect(await logsFor(eventId)).toEqual([]);
  }

  async function newAccount(key: (typeof MADE)[number], role: string, lead: Actor | null) {
    const email = `it-78-${key.toLowerCase()}-${randomUUID().slice(0, 8)}@connectsphere.example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    madeUsers.push(data.user.id);
    const profile = await admin.from("users").insert({
      id: data.user.id,
      role,
      full_name: `IT-78 ${key}`,
      email,
      supervising_lead_id: lead?.userId ?? null,
    });
    if (profile.error) throw new Error(profile.error.message);
    who[key] = await signInAs(email);
  }

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    await newAccount("leadA", "event_coordinator_lead", null);
    await newAccount("leadB", "event_coordinator_lead", null);
    await newAccount("loneLead", "event_coordinator_lead", null); // no coordinators (AC7)
    await newAccount("coordA1", "event_coordinator", who.leadA);
    await newAccount("coordA2", "event_coordinator", who.leadA);
    await newAccount("coordB", "event_coordinator", who.leadB);
    // Deactivated after linking: signInAs only needs the auth account
    await newAccount("inactiveA", "event_coordinator", who.leadA);
    await admin.from("users").update({ is_active: false }).eq("id", who.inactiveA.userId);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // cascades the logs
    if (madeUsers.length > 0) await admin.from("users").update({ supervising_lead_id: null }).in("id", madeUsers);
    for (const id of madeUsers) await admin.auth.admin.deleteUser(id);
  });

  // AC1: the Lead's eligible coordinators (active, linked to them), each with a workload count
  it("SCRUM-78/AC1 the eligible coordinators are the Lead's active coordinators, each with a workload count", async () => {
    const { data, error } = await who.leadA.client.rpc("lead_coordinator_overview");
    expect(error).toBeNull();
    const rows = data as { id: string; workload: number }[];
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([who.coordA1.userId, who.coordA2.userId]));
    for (const other of [who.inactiveA, who.coordB, who.priya, who.siti]) expect(rows.map((r) => r.id)).not.toContain(other.userId);
    for (const row of rows) expect(typeof row.workload).toBe("number");
  });
  // end of AC1

  // AC2: the chosen coordinator becomes the only assigned coordinator
  it("SCRUM-78/AC2 assigns the event to the chosen coordinator, who becomes its only coordinator", async () => {
    const eventId = await newEvent();

    const { error } = await assignAs(who.leadA, eventId, who.coordA1.userId);

    expect(error).toBeNull();
    expect(await assignedTo(eventId)).toBe(who.coordA1.userId);
  });

  it("SCRUM-78/AC2 records the first assignment in the assignment history", async () => {
    const eventId = await newEvent();

    await assignAs(who.leadA, eventId, who.coordA2.userId);

    expect(await logsFor(eventId)).toEqual([
      { coordinator_id: who.coordA2.userId, previous_coordinator_id: null, assigned_by: who.leadA.userId },
    ]);
  });
  // end of AC2

  // AC3: it shows as assigned, and has left the unassigned queue
  it("SCRUM-78/AC3 the assigned event leaves the unassigned queue and shows under its coordinator", async () => {
    const eventId = await newEvent();
    const queue = async () => ((await who.leadB.client.rpc("lead_unassigned_queue")).data as { id: string }[]).map((r) => r.id);
    expect(await queue()).toContain(eventId);

    await assignAs(who.leadA, eventId, who.coordA1.userId);

    expect(await queue()).not.toContain(eventId);
    const listed = (await who.leadA.client.rpc("lead_coordinator_events", { p_coordinator_id: who.coordA1.userId })).data as { id: string }[];
    expect(listed.map((r) => r.id)).toContain(eventId);
  });
  // end of AC3

  // AC4: no cap; a coordinator who already has non-closed events can be given another (BR5)
  it("SCRUM-78/AC4 assigns to a coordinator who already has other non-closed events", async () => {
    const first = await newEvent();
    await assignAs(who.leadA, first, who.coordA1.userId);
    const before = await workloadOf(who.leadA, who.coordA1.userId);
    expect(before).toBeGreaterThan(0);

    const second = await newEvent();
    const { error } = await assignAs(who.leadA, second, who.coordA1.userId);

    expect(error).toBeNull();
    expect(await assignedTo(second)).toBe(who.coordA1.userId);
    expect(await workloadOf(who.leadA, who.coordA1.userId)).toBe(before! + 1);
  });
  // end of AC4

  // AC5: two assignments race for the same event; exactly one wins and the other is told it's already assigned
  it("SCRUM-78/AC5 when two Leads assign the same event at the same moment, exactly one wins", async () => {
    for (let round = 0; round < 5; round++) {
      const eventId = await newEvent();

      const [a, b] = await Promise.all([
        assignAs(who.leadA, eventId, who.coordA1.userId),
        assignAs(who.leadB, eventId, who.coordB.userId),
      ]);

      const winners = [a, b].filter((r) => r.error === null);
      const losers = [a, b].filter((r) => r.error !== null);
      expect(winners).toHaveLength(1);
      expect(losers.map((r) => r.error?.code)).toEqual([ALREADY_ASSIGNED]);
      const winner = a.error === null ? who.coordA1.userId : who.coordB.userId;
      expect(await assignedTo(eventId)).toBe(winner);
      expect((await logsFor(eventId)).map((l) => l.coordinator_id)).toEqual([winner]);
    }
  });

  it("SCRUM-78/AC5 an assignment confirmed after someone else's is rejected, and the existing assignment is unchanged", async () => {
    const eventId = await newEvent();
    await assignAs(who.leadB, eventId, who.coordB.userId);

    const { error } = await assignAs(who.leadA, eventId, who.coordA1.userId);

    expect(error?.code).toBe(ALREADY_ASSIGNED);
    expect(await assignedTo(eventId)).toBe(who.coordB.userId);
    expect(await logsFor(eventId)).toHaveLength(1);
  });
  // end of AC5

  // AC6 / BR2: a closed event cannot be assigned
  it.each(CLOSED_EVENT_STATUSES)("SCRUM-78/AC6 refuses to assign a %s event", async (status) => {
    const eventId = await newEvent({ status });
    await expectRefused(assignAs(who.leadA, eventId, who.coordA1.userId), CLOSED, eventId);
  });
  // end of AC6

  // AC7: with no eligible coordinators the assignment can't be completed
  it("SCRUM-78/AC7 a Lead with no eligible coordinators has none to choose, and cannot complete an assignment", async () => {
    const eventId = await newEvent();
    expect((await who.loneLead.client.rpc("lead_coordinator_overview")).data).toEqual([]);

    await expectRefused(assignAs(who.loneLead, eventId, who.coordA1.userId), NOT_ELIGIBLE, eventId);
  });

  // BR4 + eligibility: only an active coordinator linked to this Lead
  it.each(["coordB", "priya", "siti", "inactiveA", "seededCoordinator", "venueStaff", "leadB"] as const)(
    "SCRUM-78/AC7 refuses to assign to %s, who is not one of the Lead's active coordinators",
    async (target) => {
      const eventId = await newEvent();
      await expectRefused(assignAs(who.leadA, eventId, who[target].userId), NOT_ELIGIBLE, eventId);
    },
  );
  // end of AC7

  // AC8: starting (loading the choices) and cancelling changes nothing
  it("SCRUM-78/AC8 looking at the choices and cancelling leaves the event unassigned", async () => {
    const eventId = await newEvent();
    await who.leadA.client.rpc("lead_coordinator_overview");

    expect(await assignedTo(eventId)).toBeNull();
    expect(await logsFor(eventId)).toEqual([]);
  });
  // end of AC8

  // AC9: nobody but a Lead can assign, by any route into the database, and nothing changes
  it.each(["coordA1", "seededCoordinator", "venueStaff", "organiser"] as const)("SCRUM-78/AC9 refuses lead_assign_coordinator to a %s", async (actor) => {
    const eventId = await newEvent();
    await expectRefused(assignAs(who[actor], eventId, who.coordA1.userId), DENIED, eventId);
  });

  // SCRUM-156: a coordinator cannot even see an unassigned event, so a claim finds no row to change; before, the
  // events_assignment_guard trigger refused it with 42501. Either way the event stays unassigned and nothing is logged.
  it("SCRUM-78/AC9 a coordinator can no longer claim an unassigned event by updating it directly", async () => {
    const eventId = await newEvent();
    const { data, error } = await who.coordA1.client
      .from("events")
      .update({ assigned_coordinator_id: who.coordA1.userId })
      .eq("id", eventId)
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
    expect(await assignedTo(eventId)).toBeNull();
    expect(await logsFor(eventId)).toEqual([]);
  });

  it("SCRUM-78/AC9 a coordinator can no longer claim an unassigned event through assign_coordinator()", async () => {
    const eventId = await newEvent();
    const { data } = await who.coordA1.client.rpc("assign_coordinator", {
      p_event_id: eventId,
      p_coordinator_id: who.coordA1.userId,
    });
    expect(data ?? []).toEqual([]);
    expect(await assignedTo(eventId)).toBeNull();
    expect(await logsFor(eventId)).toEqual([]);
  });

  it("SCRUM-78/AC9 a Lead cannot bypass the checks by updating the event directly", async () => {
    const eventId = await newEvent();
    const { data } = await who.leadA.client
      .from("events")
      .update({ assigned_coordinator_id: who.coordB.userId })
      .eq("id", eventId)
      .select("id");

    expect(data ?? []).toEqual([]);
    expect(await assignedTo(eventId)).toBeNull();
  });
  // end of AC9

  it("SCRUM-78 refuses a draft or a missing event as not found", async () => {
    const draft = await newEvent({ status: "draft", is_draft: true, submitted_at: null });
    await expectRefused(assignAs(who.leadA, draft, who.coordA1.userId), NOT_FOUND, draft);

    const { error } = await assignAs(who.leadA, randomUUID(), who.coordA1.userId);
    expect(error?.code).toBe(NOT_FOUND);
  });
});
