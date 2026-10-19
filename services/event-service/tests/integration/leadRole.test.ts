import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-75: Lead accounts and the link from an Event Coordinator to the one Lead who supervises them
 * (users.supervising_lead_id). Seeded accounts (supabase/seed.sql) are signed in for real, so the GoTrue + RLS path
 * is the one the app uses. The secret key arranges and restores fixtures only.
 */
export const LEAD_EMAILS = {
  leadA: "helen.ong@connectsphere.example.com",
  leadB: "samuel.tay@connectsphere.example.com",
  coordinatorA1: "rachel.tan@connectsphere.example.com", // linked to Lead A
  coordinatorA2: "marcus.lim@connectsphere.example.com", // linked to Lead A
  coordinatorB1: "priya.nair@connectsphere.example.com", // linked to Lead B
  coordinatorB2: "daniel.goh@connectsphere.example.com", // linked to Lead B
  unlinkedCoordinator: "siti.aminah@connectsphere.example.com",
  inactiveCoordinator: "kelvin.ho@connectsphere.example.com", // linked to Lead A, deactivated
  nonLead: "kenneth.wong@connectsphere.example.com", // venue staff
};

/** Postgres check_violation: the link trigger refuses a link that isn't coordinator → Lead. */
const CHECK_VIOLATION = "23514";
/** Postgres insufficient_privilege: the column grant on users. */
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-75 Event Coordinator Lead accounts and coordinator links", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<keyof typeof LEAD_EMAILS, Actor>;

  const leadOf = async (userId: string) =>
    (await admin.from("users").select("supervising_lead_id").eq("id", userId).single()).data?.supervising_lead_id as string | null;

  beforeAll(async () => {
    for (const key of Object.keys(LEAD_EMAILS) as Array<keyof typeof LEAD_EMAILS>) who[key] = await signInAs(LEAD_EMAILS[key]);
  });

  // Put back the seeded links whatever a test did
  afterAll(async () => {
    if (!hasDb || !who.leadB) return;
    await admin.from("users").update({ supervising_lead_id: who.leadA.userId }).in("id", [who.coordinatorA1.userId, who.coordinatorA2.userId]);
    await admin.from("users").update({ supervising_lead_id: who.leadB.userId }).in("id", [who.coordinatorB1.userId, who.coordinatorB2.userId]);
    await admin.from("users").update({ supervising_lead_id: null }).eq("id", who.unlinkedCoordinator.userId);
  });

  // AC2: a staff account set up with the Lead role (seed data) is recognised as a Lead when it logs in
  it("SCRUM-75/AC2 seeded Lead accounts sign in and are recognised as Leads", async () => {
    for (const lead of [who.leadA, who.leadB]) {
      const { data } = await lead.client.from("users").select("role, is_active").eq("id", lead.userId).single();
      expect(data).toEqual({ role: "event_coordinator_lead", is_active: true });
    }
  });
  // end of AC2

  // AC5: a coordinator is linked to one Lead; a Lead can supervise any number of coordinators
  it("SCRUM-75/AC5 seeded coordinators are each linked to one Lead, and a Lead supervises several", async () => {
    expect(await leadOf(who.coordinatorA1.userId)).toBe(who.leadA.userId);
    expect(await leadOf(who.coordinatorA2.userId)).toBe(who.leadA.userId);
    expect(await leadOf(who.inactiveCoordinator.userId)).toBe(who.leadA.userId);
    expect(await leadOf(who.coordinatorB1.userId)).toBe(who.leadB.userId);
    expect(await leadOf(who.coordinatorB2.userId)).toBe(who.leadB.userId);
    expect(await leadOf(who.unlinkedCoordinator.userId)).toBeNull();
  });

  it("SCRUM-75/AC5 linking a coordinator to another Lead replaces the old link, so they only ever have one", async () => {
    const { error } = await admin.from("users").update({ supervising_lead_id: who.leadA.userId }).eq("id", who.coordinatorB1.userId);
    expect(error).toBeNull();
    expect(await leadOf(who.coordinatorB1.userId)).toBe(who.leadA.userId);

    await admin.from("users").update({ supervising_lead_id: who.leadB.userId }).eq("id", who.coordinatorB1.userId);
    expect(await leadOf(who.coordinatorB1.userId)).toBe(who.leadB.userId);
  });

  it("SCRUM-75/AC5 a coordinator can only be linked to a Lead, not to another role", async () => {
    const { error } = await admin.from("users").update({ supervising_lead_id: who.nonLead.userId }).eq("id", who.unlinkedCoordinator.userId);

    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(await leadOf(who.unlinkedCoordinator.userId)).toBeNull();
  });

  it("SCRUM-75/AC5 only an Event Coordinator can be linked to a Lead", async () => {
    const { error } = await admin.from("users").update({ supervising_lead_id: who.leadA.userId }).eq("id", who.nonLead.userId);

    expect(error?.code).toBe(CHECK_VIOLATION);
    expect(await leadOf(who.nonLead.userId)).toBeNull();
  });
  // end of AC5

  // AC7: links are Lead data; nobody changes them through the API (they are set up by an admin / seed data)
  it.each(["nonLead", "coordinatorA1", "leadB"] as const)(
    "SCRUM-75/AC7 a signed-in %s cannot change which Lead a coordinator is linked to, and nothing changes",
    async (actor) => {
      const { error } = await who[actor].client
        .from("users")
        .update({ supervising_lead_id: who.leadB.userId })
        .eq("id", who.coordinatorA1.userId);

      expect(error?.code).toBe(DENIED);
      expect(await leadOf(who.coordinatorA1.userId)).toBe(who.leadA.userId);
    },
  );
  // end of AC7
});
