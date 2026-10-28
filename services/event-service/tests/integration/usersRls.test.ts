import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-154 (docs/specs/users-contact-privacy.md): contact details on `users` are private (migration 52). Every check
 * signs in as a seeded user, so it goes through the same JWT + publishable-key path the services use. Fixtures are
 * created with the secret key (which bypasses RLS), are prefixed "IT-" and are removed afterwards. Assertions only
 * cover rows these tests create or the seeded accounts' own fields, never a count of a whole table.
 */
const EMAILS = {
  organiserA: "jason.chua@techconnect.example.com",
  organiserB: "weiling.ong@techconnect.example.com",
  coordinatorA: "rachel.tan@connectsphere.example.com",
  coordinatorB: "marcus.lim@connectsphere.example.com",
  lead: "helen.ong@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  technicalSupport: "aaron.koh@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
  otherAttendee: "bryan.ho@example.com",
};
type Who = keyof typeof EMAILS;

/** Postgres "insufficient_privilege": a missing grant, or an RLS WITH CHECK failure. */
const DENIED = "42501";

describe.skipIf(!hasDb)("SCRUM-154 users: contact details are private (migration 52)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<Who, Actor>;
  const everyone = Object.keys(EMAILS) as Who[];
  const eventIds: string[] = [];
  let eventA: string; // organiser A, coordinator A, with a registration from each attendee

  beforeAll(async () => {
    for (const key of everyone) who[key] = await signInAs(EMAILS[key]);

    const { data: event, error } = await admin
      .from("events")
      .insert({
        name: `IT-users-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: who.organiserA.userId,
        assigned_coordinator_id: who.coordinatorA.userId,
        status: "submitted",
        is_draft: false,
        expected_attendance: 50,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    eventA = event.id as string;
    eventIds.push(eventA);

    const registrations = await admin.from("event_registrations").insert([
      { event_id: eventA, attendee_id: who.attendee.userId, status: "waitlisted" },
      { event_id: eventA, attendee_id: who.otherAttendee.userId, status: "waitlisted" },
    ]);
    if (registrations.error) throw new Error(registrations.error.message);
  });

  afterAll(async () => {
    if (eventIds.length === 0) return;
    await admin.from("events").delete().in("id", eventIds); // cascades the registrations
  });

  // supervising_lead_id: the Lead's overview functions read it as the caller (migrations 22 to 24), so it must stay readable
  const publicColumns = "id, role, full_name, department, supervising_lead_id";

  describe("SCRUM-154/AC1 another person's contact columns are refused", () => {
    it("154-S1: no role can select another user's email, phone or preferences", async () => {
      for (const reader of everyone) {
        const target = who[reader === "organiserA" ? "coordinatorA" : "organiserA"];
        for (const column of ["email", "phone", "communication_preferences"]) {
          const { data, error } = await who[reader].client.from("users").select(column).eq("id", target.userId);
          expect(error?.code, `${reader} reading ${column}`).toBe(DENIED);
          expect(data ?? []).toEqual([]);
        }
      }
    });

    it("154-S2: every role can still read another user's name, role and department", async () => {
      const target = who.coordinatorA;
      for (const reader of everyone) {
        const { data, error } = await who[reader].client.from("users").select(publicColumns).eq("id", target.userId);
        expect(error, reader).toBeNull();
        expect(data).toHaveLength(1);
        expect(data![0]).toMatchObject({ id: target.userId, role: "event_coordinator" });
        expect(typeof data![0].full_name).toBe("string");
      }
    });
  });

  describe("SCRUM-154/AC5 a user reads their own contact details through my_contact_details()", () => {
    it("154-S3: returns the caller's own email, phone and preferences, and only theirs", async () => {
      for (const key of everyone) {
        const { data, error } = await who[key].client.rpc("my_contact_details");
        expect(error, key).toBeNull();
        expect(data).toHaveLength(1);
        expect(data![0].email).toBe(EMAILS[key]);
        expect(data![0]).toHaveProperty("phone");
        expect(data![0]).toHaveProperty("communication_preferences");
      }
    });

    it("154-S3: is refused to a caller who is not signed in", async () => {
      const { createClient } = await import("@supabase/supabase-js");
      const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await anon.rpc("my_contact_details");
      expect(error).not.toBeNull();
    });
  });

  describe("SCRUM-154/AC3, AC4 attendee contact details for the people who manage the event", () => {
    it("154-S4: the event's organiser and its assigned coordinator get every registration's name, email and phone", async () => {
      for (const manager of ["organiserA", "coordinatorA"] as const) {
        const { data, error } = await who[manager].client.rpc("event_registration_contacts", { p_event_id: eventA });
        expect(error, manager).toBeNull();
        const emails = (data ?? []).map((row: { email: string }) => row.email).sort();
        expect(emails).toEqual([EMAILS.attendee, EMAILS.otherAttendee].sort());
        for (const row of data ?? []) {
          expect(row).toHaveProperty("registration_id");
          expect(row).toHaveProperty("attendee_id");
          expect(row).toHaveProperty("full_name");
          expect(row).toHaveProperty("phone");
        }
      }
    });

    it("154-S5: nobody else gets any row: another organiser or coordinator, the Lead, venue staff, technical support, attendees", async () => {
      for (const other of [
        "organiserB",
        "coordinatorB",
        "lead",
        "venueStaff",
        "technicalSupport",
        "attendee",
        "otherAttendee",
      ] as const) {
        const { data, error } = await who[other].client.rpc("event_registration_contacts", { p_event_id: eventA });
        expect(error, other).toBeNull();
        expect(data, other).toEqual([]);
      }
    });
  });

  describe("SCRUM-154/AC5 a user can still update their own profile fields", () => {
    it("154-S6: updates their own name, phone and preferences; role and email stay unwritable", async () => {
      const mine = who.attendee;
      const { data: before } = await admin
        .from("users")
        .select("full_name, phone, communication_preferences")
        .eq("id", mine.userId)
        .single();

      // writing the values it already has: proves the grant and the policy without changing the seeded account
      const own = await mine.client.from("users").update(before!).eq("id", mine.userId).select("id");
      expect(own.error).toBeNull();
      expect(own.data).toHaveLength(1);

      for (const forbidden of [{ role: "event_coordinator" }, { email: "it-changed@example.com" }]) {
        const { error } = await mine.client.from("users").update(forbidden).eq("id", mine.userId);
        expect(error?.code, JSON.stringify(forbidden)).toBe(DENIED);
      }
      const { data: after } = await admin.from("users").select("role, email").eq("id", mine.userId).single();
      expect(after).toEqual({ role: "attendee", email: EMAILS.attendee });
    });
  });

  describe("SCRUM-154/AC6 nobody changes, adds or deletes another person's row", () => {
    it("154-S7: updating another user's row changes nothing", async () => {
      const target = who.organiserA;
      const { data: before } = await admin.from("users").select("full_name, phone").eq("id", target.userId).single();
      for (const key of everyone.filter((k) => k !== "organiserA")) {
        const { data } = await who[key].client.from("users").update(before!).eq("id", target.userId).select("id");
        expect(data ?? [], key).toEqual([]);
      }
    });

    it("154-S7: no role can insert or delete a users row", async () => {
      for (const key of everyone) {
        const insert = await who[key].client
          .from("users")
          .insert({ id: crypto.randomUUID(), role: "attendee", full_name: "IT intruder", email: `it-${key}@example.com` });
        expect(insert.error?.code, `${key} insert`).toBe(DENIED);

        const target = who[key === "organiserA" ? "organiserB" : "organiserA"];
        const del = await who[key].client.from("users").delete().eq("id", target.userId).select("id");
        expect(del.error?.code, `${key} delete`).toBe(DENIED);
      }
      // the seeded accounts are all still there
      const { data } = await admin.from("users").select("id").in("id", everyone.map((k) => who[k].userId));
      expect(data).toHaveLength(everyone.length);
    });
  });
});
