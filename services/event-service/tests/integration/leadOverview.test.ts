import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLOSED_EVENT_STATUSES } from "@spm-t5/shared";
import { adminClient, hasDb, SEED_PASSWORD, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-81: a Lead's coordinator overview (lead_coordinator_overview()) and one coordinator's non-closed events
 * (lead_coordinator_events()), migration 22. Both are called as the signed-in user, so RLS applies.
 *
 * Seeded coordinators already hold events, so exact counts use accounts made here: two coordinators linked to Lead A
 * ("zero" holds nothing, "busy" holds the fixtures) and a Lead with no coordinators. Everything made here is removed
 * afterwards; fixture events are named "IT-81-" and dated 2031.
 */
const EMAILS = {
  leadA: "helen.ong@connectsphere.example.com",
  leadB: "samuel.tay@connectsphere.example.com",
  rachel: "rachel.tan@connectsphere.example.com", // active, linked to Lead A
  marcus: "marcus.lim@connectsphere.example.com", // active, linked to Lead A
  kelvin: "kelvin.ho@connectsphere.example.com", // deactivated, linked to Lead A
  priya: "priya.nair@connectsphere.example.com", // linked to Lead B
  siti: "siti.aminah@connectsphere.example.com", // not linked
  venueStaff: "kenneth.wong@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
};

const DENIED = "42501";

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
  const who = {} as Record<keyof typeof EMAILS | "zero" | "busy" | "loneLead", Actor>;
  const madeUsers: string[] = [];
  const eventIds: string[] = [];
  const ev = {} as Record<string, string>;

  /** An account made for this suite (removed afterwards), signed in so it can be used as an actor. */
  async function newAccount(key: "zero" | "busy" | "loneLead", role: string, lead: string | null) {
    const email = `it-81-${key.toLowerCase()}-${randomUUID().slice(0, 8)}@connectsphere.example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    madeUsers.push(data.user.id);
    const profile = await admin.from("users").insert({
      id: data.user.id,
      role,
      full_name: `IT-81 ${key}`,
      email,
      is_active: true,
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
    await newAccount("zero", "event_coordinator", who.leadA.userId);
    await newAccount("busy", "event_coordinator", who.leadA.userId);
    await newAccount("loneLead", "event_coordinator_lead", null);
    for (const status of ["submitted", "approved", "returned"]) await newEvent(status, who.busy.userId, status);
    for (const status of CLOSED_EVENT_STATUSES) await newEvent(status, who.busy.userId, status);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds);
    for (const id of madeUsers) await admin.auth.admin.deleteUser(id); // cascades to users
  });

  // AC1: every active coordinator linked to me, each with their workload count
  it("SCRUM-81/AC1 shows exactly the active coordinators linked to the Lead", async () => {
    const { rows, error } = await overviewAs(who.leadA);
    expect(error).toBeNull();
    expect(rows.map((r) => r.id).sort()).toEqual([who.rachel.userId, who.marcus.userId, who.zero.userId, who.busy.userId].sort());
  });

  it("SCRUM-81/AC1 does not show a deactivated, unlinked or other Lead's coordinator", async () => {
    const ids = (await overviewAs(who.leadA)).rows.map((r) => r.id);
    expect(ids).not.toContain(who.kelvin.userId);
    expect(ids).not.toContain(who.siti.userId);
    expect(ids).not.toContain(who.priya.userId);
  });

  it("SCRUM-81/AC1 each coordinator's workload is their number of non-closed events", async () => {
    const { rows } = await overviewAs(who.leadA);
    for (const coordinator of [who.rachel, who.marcus]) {
      const { data } = await admin.from("events").select("status").eq("assigned_coordinator_id", coordinator.userId);
      const expected = (data ?? []).filter((e) => !(CLOSED_EVENT_STATUSES as readonly string[]).includes(e.status)).length;
      expect(workloadOf(rows, coordinator.userId)).toBe(expected);
    }
  });

  it("SCRUM-81/AC1 a Lead cannot list another Lead's coordinator's events, an unlinked one's, or a deactivated one's", async () => {
    for (const coordinator of [who.priya, who.siti, who.kelvin]) {
      const { rows, error } = await eventsAs(who.leadA, coordinator.userId);
      expect(error?.code).toBe(DENIED);
      expect(rows).toEqual([]);
    }
  });
  // end of AC1

  // AC2: each non-closed event with name, status, preferred date and time, and expected attendance
  it("SCRUM-81/AC2 lists a coordinator's non-closed events with name, status, preferred date and time and attendance", async () => {
    const { rows, error } = await eventsAs(who.leadA, who.busy.userId);
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
    const { rows } = await overviewAs(who.leadA);
    expect(workloadOf(rows, who.zero.userId)).toBe(0);
    expect((await eventsAs(who.leadA, who.zero.userId)).rows).toEqual([]);
  });
  // end of AC3

  // AC4: closed events are left out of the count and the list
  it("SCRUM-81/AC4 leaves closed events out of the coordinator's count and list", async () => {
    expect(workloadOf((await overviewAs(who.leadA)).rows, who.busy.userId)).toBe(3);
    const listed = (await eventsAs(who.leadA, who.busy.userId)).rows.map((r) => r.id);
    for (const status of CLOSED_EVENT_STATUSES) expect(listed).not.toContain(ev[status]);
  });
  // end of AC4

  // AC5: after the assignment changes, opening the overview again shows the current assignment
  it("SCRUM-81/AC5 reflects a changed assignment the next time the overview is opened", async () => {
    await admin.from("events").update({ assigned_coordinator_id: who.zero.userId }).eq("id", ev.submitted);
    try {
      const { rows } = await overviewAs(who.leadA);
      expect(workloadOf(rows, who.busy.userId)).toBe(2);
      expect(workloadOf(rows, who.zero.userId)).toBe(1);
      expect((await eventsAs(who.leadA, who.zero.userId)).rows.map((r) => r.id)).toEqual([ev.submitted]);
      expect((await eventsAs(who.leadA, who.busy.userId)).rows.map((r) => r.id)).not.toContain(ev.submitted);
    } finally {
      await admin.from("events").update({ assigned_coordinator_id: who.busy.userId }).eq("id", ev.submitted);
    }
  });
  // end of AC5

  // AC6: a Lead with no coordinators gets an empty overview (the page shows the message)
  it("SCRUM-81/AC6 a Lead with no linked coordinators gets an empty overview", async () => {
    const { rows, error } = await overviewAs(who.loneLead);
    expect(error).toBeNull();
    expect(rows).toEqual([]);
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

  it("SCRUM-81/AC7 a Lead reads their own coordinators' events directly, but not another Lead's team's", async () => {
    const mine = await who.leadA.client.from("events").select("id").eq("id", ev.approved);
    const theirs = await who.leadB.client.from("events").select("id").eq("id", ev.approved);
    expect((mine.data ?? []).map((r) => r.id)).toEqual([ev.approved]);
    expect(theirs.data ?? []).toEqual([]);
  });
  // end of AC7
});
