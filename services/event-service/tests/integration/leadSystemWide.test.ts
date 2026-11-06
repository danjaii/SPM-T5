import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, cleanUp, CLEANUP_TIMEOUT_MS, deactivateTestUsers, deleteTestUsers, hasDb, SEED_PASSWORD, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-184 (docs/specs/lead-system-wide-scope.md, migration 81): a Lead works across every coordinator, not only the ones
 * linked to them. Accounts are made for this suite (two Leads, three coordinators linked to different Leads or to none, a
 * deactivated coordinator) so no seeded Lead's workload changes. Every assertion about a list is about rows this suite made
 * (other suites add and remove events in the same database while this one runs). Fixtures are named "IT-184-", dated 2031.
 */
const EMAILS = {
  seededCoordinator: "rachel.tan@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
  attendee: "alicia.fernandez@example.com",
};
const MADE = ["leadA", "leadB", "coordA", "coordB", "coordFree", "retired"] as const;

const DENIED = "42501";
const CLOSED = "CL001";
const NOT_ELIGIBLE = "CL003";
const NOT_ASSIGNED = "CL004";
const SAME_COORDINATOR = "CL006";

describe.skipIf(!hasDb)("SCRUM-184 the Lead sees and assigns across all coordinators (migration 81)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS | (typeof MADE)[number], Actor>;
  const eventIds: string[] = [];
  const madeUsers: string[] = [];

  async function newAccount(key: (typeof MADE)[number], role: string, lead: Actor | null, isActive = true) {
    const email = `it-184-${key.toLowerCase()}-${randomUUID().slice(0, 8)}@connectsphere.example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    madeUsers.push(data.user.id);
    const profile = await admin.from("users").insert({
      id: data.user.id,
      role,
      full_name: `IT-184 ${key}`,
      email,
      is_active: isActive,
      supervising_lead_id: lead?.userId ?? null,
    });
    if (profile.error) throw new Error(profile.error.message);
    who[key] = await signInAs(email);
  }

  async function newEvent(coordinator: Actor | null, fields: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-184-${randomUUID().slice(0, 8)}`,
        organiser_id: who.organiser.userId,
        assigned_coordinator_id: coordinator?.userId ?? null,
        status: coordinator ? "planning" : "submitted",
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

  const queueIds = async (actor: Actor) => ((await actor.client.rpc("lead_unassigned_queue")).data ?? []).map((r: { id: string }) => r.id);
  const overviewAs = async (actor: Actor) => {
    const { data, error } = await actor.client.rpc("lead_coordinator_overview");
    return { rows: (data ?? []) as { id: string; full_name: string; workload: number }[], error };
  };
  const eventsOf = (actor: Actor, coordinator: Actor) => actor.client.rpc("lead_coordinator_events", { p_coordinator_id: coordinator.userId });
  const assignAs = (actor: Actor, eventId: string, coordinatorId: string) =>
    actor.client.rpc("lead_assign_coordinator", { p_event_id: eventId, p_coordinator_id: coordinatorId });
  const reassignAs = (actor: Actor, eventId: string, coordinatorId: string) =>
    actor.client.rpc("lead_reassign_coordinator", { p_event_id: eventId, p_coordinator_id: coordinatorId });
  const assignedTo = async (eventId: string) =>
    (await admin.from("events").select("assigned_coordinator_id").eq("id", eventId).single()).data?.assigned_coordinator_id as string | null;
  const logsFor = async (eventId: string) =>
    (await admin.from("coordinator_assignment_logs").select("coordinator_id, previous_coordinator_id, assigned_by").eq("event_id", eventId)).data ?? [];

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    await newAccount("leadA", "event_coordinator_lead", null);
    await newAccount("leadB", "event_coordinator_lead", null);
    await newAccount("coordA", "event_coordinator", who.leadA);
    await newAccount("coordB", "event_coordinator", who.leadB);
    await newAccount("coordFree", "event_coordinator", null);
    await newAccount("retired", "event_coordinator", who.leadA, false);
  });

  afterAll(async () => {
    await deactivateTestUsers(admin, madeUsers);
    if (eventIds.length > 0) await cleanUp("events", admin.from("events").delete().in("id", eventIds)); // cascades the logs
    await deleteTestUsers(admin, madeUsers);
  }, CLEANUP_TIMEOUT_MS);

  describe("184-S1 every unassigned request", () => {
    it("SCRUM-184/AC1 184-S1: each Lead sees a submitted unassigned event, whoever supervises whom", async () => {
      const eventId = await newEvent(null);

      expect(await queueIds(who.leadA)).toContain(eventId);
      expect(await queueIds(who.leadB)).toContain(eventId);
    });
  });

  describe("184-S2 every active assignment", () => {
    it("SCRUM-184/AC2 184-S2: the overview lists active coordinators of any Lead, and of none, but not a deactivated one", async () => {
      const { rows, error } = await overviewAs(who.leadA);

      expect(error).toBeNull();
      const ids = rows.map((r) => r.id);
      expect(ids).toEqual(expect.arrayContaining([who.coordA.userId, who.coordB.userId, who.coordFree.userId]));
      expect(ids).not.toContain(who.retired.userId);
      expect(ids).not.toContain(who.leadB.userId); // a Lead is not a coordinator
    });

    it("SCRUM-184/AC2 184-S2: another Lead's coordinator's workload counts non-closed events only", async () => {
      await newEvent(who.coordB, { status: "planning" });
      await newEvent(who.coordB, { status: "approved" });
      await newEvent(who.coordB, { status: "completed" }); // closed: not counted

      const { rows } = await overviewAs(who.leadA);

      expect(rows.find((r) => r.id === who.coordB.userId)?.workload).toBe(2);
    });

    it("SCRUM-184/AC2 184-S2: a Lead lists the non-closed events of another Lead's coordinator and of an unlinked one", async () => {
      const held = await newEvent(who.coordB, { status: "approved" });
      const free = await newEvent(who.coordFree, { status: "planning" });

      const other = await eventsOf(who.leadA, who.coordB);
      const unlinked = await eventsOf(who.leadA, who.coordFree);

      expect(other.error).toBeNull();
      expect((other.data as { id: string }[]).map((e) => e.id)).toContain(held);
      expect((unlinked.data as { id: string }[]).map((e) => e.id)).toContain(free);
    });

    it("SCRUM-184/AC2 184-S2: a Lead reads another Lead's coordinator's event directly, and the event's own row", async () => {
      const held = await newEvent(who.coordB, { status: "approved" });

      const { data } = await who.leadA.client.from("events").select("id, assigned_coordinator_id").eq("id", held);

      expect(data).toEqual([{ id: held, assigned_coordinator_id: who.coordB.userId }]);
    });

    it("SCRUM-184/AC2 184-S2: a deactivated coordinator's events are still refused", async () => {
      const { error } = await eventsOf(who.leadA, who.retired);
      expect(error?.code).toBe(DENIED);
    });
  });

  describe("184-S3 assign or reassign to any coordinator", () => {
    it("SCRUM-184/AC3 184-S3: a Lead assigns an unassigned event to another Lead's coordinator, and it is logged", async () => {
      const eventId = await newEvent(null);

      const { error } = await assignAs(who.leadA, eventId, who.coordB.userId);

      expect(error).toBeNull();
      expect(await assignedTo(eventId)).toBe(who.coordB.userId);
      expect(await logsFor(eventId)).toEqual([{ coordinator_id: who.coordB.userId, previous_coordinator_id: null, assigned_by: who.leadA.userId }]);
    });

    it("SCRUM-184/AC3 184-S3: a Lead assigns to a coordinator nobody supervises", async () => {
      const eventId = await newEvent(null);

      expect((await assignAs(who.leadA, eventId, who.coordFree.userId)).error).toBeNull();
      expect(await assignedTo(eventId)).toBe(who.coordFree.userId);
    });

    it("SCRUM-184/AC3 184-S3: a Lead reassigns an event held by another Lead's coordinator to any coordinator", async () => {
      const eventId = await newEvent(who.coordB);

      const { error } = await reassignAs(who.leadA, eventId, who.coordFree.userId);

      expect(error).toBeNull();
      expect(await assignedTo(eventId)).toBe(who.coordFree.userId);
      expect(await logsFor(eventId)).toEqual([{ coordinator_id: who.coordFree.userId, previous_coordinator_id: who.coordB.userId, assigned_by: who.leadA.userId }]);
    });

    it("SCRUM-184/AC3 184-S3: there is no workload limit on the coordinator chosen", async () => {
      const events = [await newEvent(null), await newEvent(null), await newEvent(null), await newEvent(null)];

      for (const eventId of events) expect((await assignAs(who.leadA, eventId, who.coordA.userId)).error).toBeNull();

      const { rows } = await overviewAs(who.leadA);
      expect(rows.find((r) => r.id === who.coordA.userId)?.workload).toBeGreaterThanOrEqual(4);
    });

    it.each([
      ["a deactivated coordinator", "retired"],
      ["a user who is not a coordinator", "venueStaff"],
      ["a Lead", "leadB"],
    ] as const)("SCRUM-184/AC3 184-S3: %s is not a valid target, for assign and for reassign", async (_label, key) => {
      const open = await newEvent(null);
      const held = await newEvent(who.coordA);

      expect((await assignAs(who.leadA, open, who[key].userId)).error?.code).toBe(NOT_ELIGIBLE);
      expect((await reassignAs(who.leadA, held, who[key].userId)).error?.code).toBe(NOT_ELIGIBLE);
      expect(await assignedTo(open)).toBeNull();
      expect(await assignedTo(held)).toBe(who.coordA.userId);
    });

    it("SCRUM-184/AC3 184-S3: a closed event, an unassigned event and the same coordinator are still refused for reassign", async () => {
      const closed = await newEvent(who.coordB, { status: "completed" });
      const unassigned = await newEvent(null);
      const held = await newEvent(who.coordB);

      expect((await reassignAs(who.leadA, closed, who.coordA.userId)).error?.code).toBe(CLOSED);
      expect((await reassignAs(who.leadA, unassigned, who.coordA.userId)).error?.code).toBe(NOT_ASSIGNED);
      expect((await reassignAs(who.leadA, held, who.coordB.userId)).error?.code).toBe(SAME_COORDINATOR);
      expect(await logsFor(closed)).toEqual([]);
    });
  });

  describe("184-S4 everyone else is unchanged", () => {
    it.each([
      ["a coordinator", "seededCoordinator"],
      ["an organiser", "organiser"],
      ["an attendee", "attendee"],
      ["venue staff", "venueStaff"],
    ] as const)("SCRUM-184/AC4 184-S4: %s is refused by the Lead functions", async (_label, key) => {
      const eventId = await newEvent(null);

      expect((await overviewAs(who[key])).error?.code).toBe(DENIED);
      expect((await eventsOf(who[key], who.coordA)).error?.code).toBe(DENIED);
      expect((await assignAs(who[key], eventId, who.coordA.userId)).error?.code).toBe(DENIED);
      expect((await reassignAs(who[key], eventId, who.coordA.userId)).error?.code).toBe(DENIED);
      expect(await assignedTo(eventId)).toBeNull();
    });

    it("SCRUM-184/AC4 184-S4: a coordinator still reads only the events assigned to them", async () => {
      const mine = await newEvent(who.coordA);
      const theirs = await newEvent(who.coordB);

      const { data } = await who.coordA.client.from("events").select("id").in("id", [mine, theirs]);

      expect((data ?? []).map((r) => r.id)).toEqual([mine]);
    });

    it("SCRUM-184/AC4 184-S4: a Lead still cannot read a draft", async () => {
      const draft = await newEvent(who.coordB, { status: "draft", is_draft: true });

      const { data } = await who.leadA.client.from("events").select("id").eq("id", draft);

      expect(data).toEqual([]);
    });
  });

  describe("184-S5 the Lead's queue summary", () => {
    it("SCRUM-184/AC2 184-S5: counts this month's events of every coordinator, not only the Lead's own team's", async () => {
      // leadA's only active coordinator holds nothing; the event below is held by leadB's coordinator
      const sgtNow = new Date(Date.now() + 8 * 3_600_000);
      const monthStart = new Date(Date.UTC(sgtNow.getUTCFullYear(), sgtNow.getUTCMonth(), 1) - 8 * 3_600_000);
      const start = new Date(monthStart.getTime() + 3_600_000);
      await newEvent(who.coordB, {
        status: "planning",
        preferred_start_datetime: start.toISOString(),
        preferred_end_datetime: new Date(start.getTime() + 3_600_000).toISOString(),
      });

      const { data, error } = await who.leadA.client.rpc("lead_queue_summary");

      expect(error).toBeNull();
      expect((data as { events_this_month: number }[])[0]!.events_this_month).toBeGreaterThanOrEqual(1);
    });
  });
});
