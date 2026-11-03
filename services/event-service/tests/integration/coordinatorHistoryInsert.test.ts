import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, SEED_PASSWORD, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-183 (docs/specs/coordinator-history-own-events.md): a coordinator may add an event_coordinator_history row only for an
 * event assigned to them (migration 77). Every check signs in as a user, so it goes through the same JWT + publishable-key path
 * event-service uses. The Lead and the two coordinators are made for this suite ("IT-183-"), so assigning events here never
 * changes a seeded Lead's workload, which other suites count while this one runs. The other roles are seeded accounts that are
 * only refused. Events are made with the secret key, named "IT-183-", dated 2031 and removed afterwards. Assertions only cover
 * rows these tests create, never a count of a whole table (CLAUDE.md, SCRUM-143).
 */
const SEEDED = {
  organiser: "jason.chua@techconnect.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  technicalSupport: "aaron.koh@connectsphere.example.com",
  safetyOfficer: "farah.ismail@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
};
const MADE = ["lead", "coordA", "coordB"] as const;

/** Postgres "insufficient_privilege": an RLS WITH CHECK failure. */
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-183 coordinator history rows only for the coordinator's own events (migration 77)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof SEEDED | (typeof MADE)[number], Actor>;
  const eventIds: string[] = [];
  const madeUsers: string[] = [];

  async function newEvent(coordinator: string | null): Promise<string> {
    const { data, error } = await admin
      .from("events")
      .insert({
        name: `IT-183-${randomUUID().slice(0, 8)}`,
        organiser_id: who.organiser.userId,
        assigned_coordinator_id: coordinator,
        status: "submitted",
        is_draft: false,
        preferred_start_datetime: "2031-08-01T02:00:00Z",
        preferred_end_datetime: "2031-08-01T06:00:00Z",
        expected_attendance: 40,
        submitted_at: "2031-01-01T00:00:00Z",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventIds.push(data.id as string);
    return data.id as string;
  }

  async function newAccount(key: (typeof MADE)[number], role: string, lead: Actor | null) {
    const email = `it-183-${key.toLowerCase()}-${randomUUID().slice(0, 8)}@connectsphere.example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: SEED_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message);
    madeUsers.push(data.user.id);
    const profile = await admin.from("users").insert({
      id: data.user.id,
      role,
      full_name: `IT-183 ${key}`,
      email,
      supervising_lead_id: lead?.userId ?? null,
    });
    if (profile.error) throw new Error(profile.error.message);
    who[key] = await signInAs(email);
  }

  const row = (eventId: string, coordinatorId: string, assignedBy: string) => ({
    event_id: eventId,
    coordinator_id: coordinatorId,
    assigned_by: assignedBy,
  });

  /** The history rows of an event, read with the secret key so row level security cannot hide one. */
  const rowsFor = async (eventId: string) =>
    (await admin.from("event_coordinator_history").select("coordinator_id, assigned_by").eq("event_id", eventId)).data ?? [];

  beforeAll(async () => {
    for (const key of Object.keys(SEEDED) as Array<keyof typeof SEEDED>) who[key] = await signInAs(SEEDED[key]);
    await newAccount("lead", "event_coordinator_lead", null);
    await newAccount("coordA", "event_coordinator", who.lead);
    await newAccount("coordB", "event_coordinator", who.lead);
  });

  afterAll(async () => {
    if (eventIds.length > 0) await admin.from("events").delete().in("id", eventIds); // cascades the history and the logs
    if (madeUsers.length > 0) await admin.from("users").update({ supervising_lead_id: null }).in("id", madeUsers);
    for (const id of madeUsers) await admin.auth.admin.deleteUser(id);
  });

  describe("SCRUM-183/AC1 the assigned coordinator adds a row (183-S1)", () => {
    it("183-S1: the row is saved and the coordinator and the organiser can read it", async () => {
      const eventId = await newEvent(who.coordA.userId);

      const added = await who.coordA.client
        .from("event_coordinator_history")
        .insert(row(eventId, who.coordA.userId, who.coordA.userId))
        .select("id")
        .single();

      expect(added.error).toBeNull();
      expect(await rowsFor(eventId)).toEqual([{ coordinator_id: who.coordA.userId, assigned_by: who.coordA.userId }]);
      const seen = async (actor: Actor) =>
        ((await actor.client.from("event_coordinator_history").select("id").eq("event_id", eventId)).data ?? []).length;
      expect(await seen(who.coordA)).toBe(1);
      expect(await seen(who.organiser)).toBe(1);
    });

    it("183-S1: the row may name another coordinator, since only whose event it is is checked", async () => {
      const eventId = await newEvent(who.coordA.userId);

      const added = await who.coordA.client.from("event_coordinator_history").insert(row(eventId, who.coordB.userId, who.coordA.userId));

      expect(added.error).toBeNull();
    });

    it("183-S1: even on their own event, a coordinator cannot put someone else's name in assigned_by", async () => {
      const eventId = await newEvent(who.coordA.userId);

      const refused = await who.coordA.client.from("event_coordinator_history").insert(row(eventId, who.coordA.userId, who.coordB.userId));

      expect(refused.error?.code).toBe(DENIED);
      expect(await rowsFor(eventId)).toEqual([]);
    });
  });

  describe("SCRUM-183/AC2 a coordinator who is not assigned is refused (183-S2)", () => {
    it("183-S2: a coordinator cannot add a row to an event assigned to another coordinator, whoever the row names", async () => {
      const eventId = await newEvent(who.coordA.userId);

      for (const named of [who.coordB.userId, who.coordA.userId]) {
        const refused = await who.coordB.client.from("event_coordinator_history").insert(row(eventId, named, who.coordB.userId));
        expect(refused.error?.code).toBe(DENIED);
      }

      expect(await rowsFor(eventId)).toEqual([]);
    });

    it("183-S2: a coordinator cannot add a row to an event nobody is assigned to", async () => {
      const eventId = await newEvent(null);

      const refused = await who.coordA.client.from("event_coordinator_history").insert(row(eventId, who.coordA.userId, who.coordA.userId));

      expect(refused.error?.code).toBe(DENIED);
      expect(await rowsFor(eventId)).toEqual([]);
    });

    it("183-S2: once the Lead reassigns the event, the previous coordinator is refused and the new one is not", async () => {
      const eventId = await newEvent(who.coordA.userId);
      const reassigned = await who.lead.client.rpc("lead_reassign_coordinator", { p_event_id: eventId, p_coordinator_id: who.coordB.userId });
      expect(reassigned.error).toBeNull();

      const previous = await who.coordA.client.from("event_coordinator_history").insert(row(eventId, who.coordA.userId, who.coordA.userId));
      const current = await who.coordB.client.from("event_coordinator_history").insert(row(eventId, who.coordB.userId, who.coordB.userId));

      expect(previous.error?.code).toBe(DENIED);
      expect(current.error).toBeNull();
      expect(await rowsFor(eventId)).toEqual([{ coordinator_id: who.coordB.userId, assigned_by: who.coordB.userId }]);
    });

    it.each(["organiser", "lead", "venueStaff", "technicalSupport", "safetyOfficer", "attendee"] as const)(
      "183-S2: %s is refused, even on an event with an assigned coordinator",
      async (key) => {
        const eventId = await newEvent(who.coordA.userId);

        const refused = await who[key].client.from("event_coordinator_history").insert(row(eventId, who.coordA.userId, who[key].userId));

        expect(refused.error?.code).toBe(DENIED);
        expect(await rowsFor(eventId)).toEqual([]);
      },
    );
  });

  describe("SCRUM-183/AC3 the existing flows keep working (183-S3)", () => {
    it("183-S3: the Lead assigns and then reassigns an event, and both write their assignment log as before", async () => {
      const eventId = await newEvent(null);

      const assigned = await who.lead.client.rpc("lead_assign_coordinator", { p_event_id: eventId, p_coordinator_id: who.coordA.userId });
      const reassigned = await who.lead.client.rpc("lead_reassign_coordinator", { p_event_id: eventId, p_coordinator_id: who.coordB.userId });

      expect(assigned.error).toBeNull();
      expect(reassigned.error).toBeNull();
      const logs = (await admin.from("coordinator_assignment_logs").select("coordinator_id, previous_coordinator_id, assigned_by").eq("event_id", eventId)).data ?? [];
      expect(logs).toHaveLength(2);
      expect(logs).toContainEqual({ coordinator_id: who.coordA.userId, previous_coordinator_id: null, assigned_by: who.lead.userId });
      expect(logs).toContainEqual({ coordinator_id: who.coordB.userId, previous_coordinator_id: who.coordA.userId, assigned_by: who.lead.userId });
      expect(await rowsFor(eventId)).toEqual([]); // neither flow writes event_coordinator_history
    });

    it("183-S3: the assigned coordinator takes the event through review, and the status change is saved with its history", async () => {
      const eventId = await newEvent(who.coordA.userId);

      const started = await who.coordA.client.rpc("change_event_status", { p_event_id: eventId, p_new_status: "under_review" }).maybeSingle();

      expect(started.error).toBeNull();
      expect(started.data).toMatchObject({ id: eventId, status: "under_review" });
      const history = (await admin.from("event_status_history").select("old_status, new_status, changed_by").eq("event_id", eventId)).data ?? [];
      expect(history).toEqual([{ old_status: "submitted", new_status: "under_review", changed_by: who.coordA.userId }]);
      expect(await rowsFor(eventId)).toEqual([]);
    });
  });

  describe("SCRUM-183/AC1,AC3 nothing else about the table changed (183-S4)", () => {
    it("183-S4: a row stays unchangeable and undeletable, even for the assigned coordinator who added it", async () => {
      const eventId = await newEvent(who.coordA.userId);
      const added = await who.coordA.client
        .from("event_coordinator_history")
        .insert(row(eventId, who.coordA.userId, who.coordA.userId))
        .select("id")
        .single();
      expect(added.error).toBeNull();

      const edited = await who.coordA.client.from("event_coordinator_history").update({ unassigned_at: new Date().toISOString() }).eq("id", added.data!.id);
      const deleted = await who.coordA.client.from("event_coordinator_history").delete().eq("id", added.data!.id);

      expect(edited.error?.code).toBe(DENIED);
      expect(deleted.error?.code).toBe(DENIED);
      expect(await rowsFor(eventId)).toHaveLength(1);
    });
  });
});
