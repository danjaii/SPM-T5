import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOSED_EVENT_STATUSES } from "@spm-t5/shared";
import { adminClient, cleanUp, CLEANUP_TIMEOUT_MS, deactivateTestUsers, deleteTestUsers, hasDb, SEED_PASSWORD, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-81: a Lead's coordinator overview (lead_coordinator_overview()) and one coordinator's non-closed events
 * (lead_coordinator_events()), migration 22. Both are called as the signed-in user, so RLS applies.
 *
 * Every Lead and coordinator the checks look at is made here, because other test files link and relink seeded ones while
 * they run (SCRUM-143): this suite's own Lead with two active coordinators ("zero" holds nothing, "busy" holds the
 * fixtures) and a deactivated one ("retired"), a second Lead with a coordinator of their own ("stranger"), a coordinator
 * linked to no Lead ("unlinked"), and a Lead with no coordinators.
 * Everything made here is removed afterwards; fixture events are named "IT-81-" and dated 2031.
 */
const EMAILS = {
  rachel: "rachel.tan@connectsphere.example.com", // a coordinator, refused the Lead's views (AC7)
  venueStaff: "kenneth.wong@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
};

const DENIED = "42501";

/** The accounts made for this suite. */
type Made = "ownLead" | "otherLead" | "loneLead" | "zero" | "busy" | "retired" | "stranger" | "unlinked";

type OverviewRow = { id: string; full_name: string; workload: number };
type EventRow = {
  id: string;
  name: string;
  status: string;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
};

describe.skipIf(!hasDb)("SCRUM-81 coordinator workload and active events (migration 22)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof EMAILS | Made, Actor>;
  const madeUsers: string[] = [];
  const eventIds: string[] = [];
  const ev = {} as Record<string, string>;

  /** An account made for this suite (removed afterwards), signed in so it can be used as an actor. */
  async function newAccount(key: Made, role: string, lead: string | null, isActive = true) {
    const email = `it-81-${key.toLowerCase()}-${randomUUID().slice(0, 8)}@connectsphere.example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    madeUsers.push(data.user.id);
    const profile = await admin.from("users").insert({
      id: data.user.id,
      role,
      full_name: `IT-81 ${key}`,
      email,
      is_active: isActive,
      supervising_lead_id: lead,
    });
    if (profile.error) throw new Error(profile.error.message);
    who[key] = await signInAs(email);
  }

  async function newEvent(key: string, coordinator: string, status: string) {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-81-${key}`,
        organiser_id: who.organiser.userId,
        assigned_coordinator_id: coordinator,
        status,
        is_draft: status === "draft",
        preferred_start_datetime: "2031-07-01T02:00:00Z",
        preferred_end_datetime: "2031-07-01T06:00:00Z",
        expected_attendance: 40,
        submitted_at: "2031-01-01T00:00:00Z",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    ev[key] = data.id as string;
  }

  const overviewAs = async (actor: Actor) => {
    const { data, error } = await actor.client.rpc("lead_coordinator_overview");
    return { rows: (data ?? []) as OverviewRow[], error };
  };
  const eventsAs = async (actor: Actor, coordinatorId: string) => {
    const { data, error } = await actor.client.rpc("lead_coordinator_events", { p_coordinator_id: coordinatorId });
    return { rows: (data ?? []) as EventRow[], error };
  };
  const workloadOf = (rows: OverviewRow[], id: string) => rows.find((r) => r.id === id)?.workload;

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Array<keyof typeof EMAILS>) who[key] = await signInAs(EMAILS[key]);
    await newAccount("ownLead", "event_coordinator_lead", null);
    await newAccount("otherLead", "event_coordinator_lead", null);
    await newAccount("zero", "event_coordinator", who.ownLead.userId);
    await newAccount("busy", "event_coordinator", who.ownLead.userId);
    await newAccount("retired", "event_coordinator", who.ownLead.userId, false);
    await newAccount("stranger", "event_coordinator", who.otherLead.userId);
    await newAccount("unlinked", "event_coordinator", null);
    await newAccount("loneLead", "event_coordinator_lead", null);
    for (const status of ["submitted", "approved", "returned"]) await newEvent(status, who.busy.userId, status);
    for (const status of CLOSED_EVENT_STATUSES) await newEvent(status, who.busy.userId, status);
  });

  afterAll(async () => {
    await deactivateTestUsers(admin, madeUsers);
    if (eventIds.length > 0) await cleanUp("events", admin.from("events").delete().in("id", eventIds));
    await deleteTestUsers(admin, madeUsers);
  }, CLEANUP_TIMEOUT_MS);

  // AC1: every active coordinator, each with their workload count. Since SCRUM-184 (migration 81) that is whoever supervises
  // them: the Lead's own, another Lead's, and ones linked to nobody
  it("SCRUM-81/AC1 shows every active coordinator, whoever supervises them", async () => {
    const { rows, error } = await overviewAs(who.ownLead);
    expect(error).toBeNull();
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([who.zero.userId, who.busy.userId, who.stranger.userId, who.unlinked.userId]));
  });

  it("SCRUM-81/AC1 does not show a deactivated coordinator, or a Lead", async () => {
    const ids = (await overviewAs(who.ownLead)).rows.map((r) => r.id);
    expect(ids).not.toContain(who.retired.userId);
    expect(ids).not.toContain(who.otherLead.userId);
    expect(ids).not.toContain(who.ownLead.userId);
  });

  // Only this suite's coordinators: other suites give the seeded ones events in parallel, so their counts can change
  // between the two reads
  it("SCRUM-81/AC1 each coordinator's workload is their number of non-closed events", async () => {
    const { rows } = await overviewAs(who.ownLead);
    for (const coordinator of [who.zero, who.busy]) {
      const { data } = await admin.from("events").select("status").eq("assigned_coordinator_id", coordinator.userId);
      const expected = (data ?? []).filter((e) => !(CLOSED_EVENT_STATUSES as readonly string[]).includes(e.status)).length;
      expect(workloadOf(rows, coordinator.userId)).toBe(expected);
    }
  });

  it("SCRUM-81/AC1 a Lead can list another Lead's coordinator's events and an unlinked one's, but not a deactivated one's", async () => {
    for (const coordinator of [who.stranger, who.unlinked]) expect((await eventsAs(who.ownLead, coordinator.userId)).error).toBeNull();
    const { rows, error } = await eventsAs(who.ownLead, who.retired.userId);
    expect(error?.code).toBe(DENIED);
    expect(rows).toEqual([]);
  });
  // end of AC1

  // AC2: each non-closed event with name, status, preferred date and time, and expected attendance
  it("SCRUM-81/AC2 lists a coordinator's non-closed events with name, status, preferred date and time and attendance", async () => {
    const { rows, error } = await eventsAs(who.ownLead, who.busy.userId);
    expect(error).toBeNull();
    expect(rows.find((r) => r.id === ev.approved)).toEqual({
      id: ev.approved,
      name: "IT-81-approved",
      status: "approved",
      preferred_start_datetime: "2031-07-01T02:00:00+00:00",
      preferred_end_datetime: "2031-07-01T06:00:00+00:00",
      expected_attendance: 40,
    });
    expect(rows.map((r) => r.id).sort()).toEqual([ev.submitted, ev.approved, ev.returned].sort());
  });
  // end of AC2

  // AC3: a coordinator with nothing on is still shown, with 0
  it("SCRUM-81/AC3 shows a coordinator with no non-closed events, with a count of 0", async () => {
    const { rows } = await overviewAs(who.ownLead);
    expect(workloadOf(rows, who.zero.userId)).toBe(0);
    expect((await eventsAs(who.ownLead, who.zero.userId)).rows).toEqual([]);
  });
  // end of AC3

  // AC4: closed events are left out of the count and the list
  it("SCRUM-81/AC4 leaves closed events out of the coordinator's count and list", async () => {
    expect(workloadOf((await overviewAs(who.ownLead)).rows, who.busy.userId)).toBe(3);
    const listed = (await eventsAs(who.ownLead, who.busy.userId)).rows.map((r) => r.id);
    for (const status of CLOSED_EVENT_STATUSES) expect(listed).not.toContain(ev[status]);
  });
  // end of AC4

  // AC5: after the assignment changes, opening the overview again shows the current assignment
  it("SCRUM-81/AC5 reflects a changed assignment the next time the overview is opened", async () => {
    await admin.from("events").update({ assigned_coordinator_id: who.zero.userId }).eq("id", ev.submitted);
    try {
      const { rows } = await overviewAs(who.ownLead);
      expect(workloadOf(rows, who.busy.userId)).toBe(2);
      expect(workloadOf(rows, who.zero.userId)).toBe(1);
      expect((await eventsAs(who.ownLead, who.zero.userId)).rows.map((r) => r.id)).toEqual([ev.submitted]);
      expect((await eventsAs(who.ownLead, who.busy.userId)).rows.map((r) => r.id)).not.toContain(ev.submitted);
    } finally {
      await admin.from("events").update({ assigned_coordinator_id: who.busy.userId }).eq("id", ev.submitted);
    }
  });
  // end of AC5

  // AC6: a Lead with no linked coordinators still sees every active coordinator (SCRUM-184, migration 81)
  it("SCRUM-81/AC6 a Lead with no linked coordinators still gets the overview of every active coordinator", async () => {
    const { rows, error } = await overviewAs(who.loneLead);
    expect(error).toBeNull();
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([who.zero.userId, who.busy.userId]));
  });
  // end of AC6

  // AC7: anyone but a Lead is refused at the database
  it.each(["rachel", "venueStaff", "organiser"] as const)("SCRUM-81/AC7 refuses the overview to a %s calling the database directly", async (actor) => {
    const overview = await overviewAs(who[actor]);
    expect(overview.error?.code).toBe(DENIED);
    expect(overview.rows).toEqual([]);

    const events = await eventsAs(who[actor], who.busy.userId);
    expect(events.error?.code).toBe(DENIED);
    expect(events.rows).toEqual([]);
  });

  it("SCRUM-81/AC7 a Lead reads the events of any coordinator directly, whoever supervises them (SCRUM-184)", async () => {
    const mine = await who.ownLead.client.from("events").select("id").eq("id", ev.approved);
    const theirs = await who.otherLead.client.from("events").select("id").eq("id", ev.approved);
    expect((mine.data ?? []).map((r) => r.id)).toEqual([ev.approved]);
    expect((theirs.data ?? []).map((r) => r.id)).toEqual([ev.approved]);
  });
  // end of AC7
});
