import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient, hasDb, signInAs, type Actor } from "./support/db";

/**
 * SCRUM-185/AC4 against Postgres (migration 84, docs/specs/registration-settings-while-replanning.md): registration is closed while
 * an event is not Confirmed (already so, now tested for an event a block returned to Planning), and the assigned coordinator can
 * adjust the capacity and the window with update_registration_settings(). Fixtures are made with the secret key, named "IT-185-",
 * dated 2032 and removed afterwards. Everyone signs in as a seeded user, so the grants and role checks are the real ones.
 */
const EMAILS = {
  coordinator: "rachel.tan@connectsphere.example.com",
  otherCoordinator: "marcus.lim@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
  lead: "helen.ong@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  alicia: "alicia.fernandez@example.com",
  bryan: "bryan.ho@example.com",
  chen: "chen.wei.jie@example.com",
  deepa: "deepa.krishnan@example.com",
  ethan: "ethan.tan@example.com",
  farhana: "farhana.yusof@example.com",
};
const CONFIRMED_ATTENDEES = ["alicia", "bryan", "chen", "deepa", "ethan"] as const;
const DETAILS = { name: "IT", email: "it@example.com", phone: "+65 9123 4567" };

const START = "2032-06-15T01:00:00.000Z";
const NEW = { p_capacity: 40, p_opens: "2032-05-01T01:00:00.000Z", p_closes: "2032-06-14T01:00:00.000Z" };
const DENIED = "42501";

type Who = keyof typeof EMAILS;

describe.skipIf(!hasDb)("SCRUM-185/AC4 registration while an event is back in Planning (migration 84)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const who = {} as Record<Who, Actor>;
  const eventIds: string[] = [];

  beforeAll(async () => {
    for (const [key, email] of Object.entries(EMAILS)) who[key as Who] = await signInAs(email);
  });
  afterAll(async () => {
    if (eventIds.length > 0) {
      await admin.from("activity_log").delete().in("entity_id", eventIds);
      await admin.from("events").delete().in("id", eventIds); // registrations go with the event
    }
  });

  const must = <T>(result: { data: T; error: { message: string } | null }): T => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };

  async function eventIn(status: string, fields: Record<string, unknown> = {}) {
    const event = must(
      await admin
        .from("events")
        .insert({
          name: `IT-185-${randomUUID().slice(0, 8)}`,
          organiser_id: who.organiser.userId,
          assigned_coordinator_id: who.coordinator.userId,
          status,
          is_draft: false,
          expected_attendance: 50,
          preferred_start_datetime: START,
          preferred_end_datetime: "2032-06-15T09:00:00.000Z",
          registration_required: true,
          registration_capacity: 100,
          registration_opens_at: "2032-01-01T00:00:00.000Z",
          registration_closes_at: "2032-06-10T00:00:00.000Z",
          ...fields,
        })
        .select("id")
        .single(),
    );
    eventIds.push(event.id as string);
    return event.id as string;
  }

  const register = async (eventId: string, key: Who, status: string) =>
    must(await admin.from("event_registrations").insert({ event_id: eventId, attendee_id: who[key].userId, status, registration_details: DETAILS }));

  const update = (actor: Actor, eventId: string, args: Record<string, unknown> = NEW) =>
    actor.client.rpc("update_registration_settings", { p_event_id: eventId, ...args });

  const settingsOf = async (eventId: string) =>
    must(await admin.from("events").select("registration_capacity, registration_opens_at, registration_closes_at").eq("id", eventId).single());
  const registrationsOf = async (eventId: string) =>
    must(await admin.from("event_registrations").select("attendee_id, status").eq("event_id", eventId));

  describe("185-S4 registration is closed while the event is in Planning", () => {
    it("SCRUM-185/AC4 185-S4: it is not listed for attendees, registering is refused, and existing registrations are untouched", async () => {
      const eventId = await eventIn("planning", { registration_opens_at: "2020-01-01T00:00:00.000Z", registration_closes_at: "2032-06-10T00:00:00.000Z" });
      await register(eventId, "alicia", "registered");
      await register(eventId, "bryan", "waitlisted");
      const before = await registrationsOf(eventId);

      const listed = must(await who.chen.client.rpc("list_public_events")) as { id: string }[];
      const attempt = await who.chen.client.rpc("register_for_event", { p_event_id: eventId, p_details: DETAILS });

      expect(listed.map((e) => e.id)).not.toContain(eventId);
      expect(attempt.error?.code).toBe("CS169");
      expect(await registrationsOf(eventId)).toEqual(before);
      expect(before).toHaveLength(2);
    });

    it("SCRUM-185/AC4 185-S4: the same event Confirmed again is listed and takes a registration", async () => {
      const eventId = await eventIn("confirmed", { registration_opens_at: "2020-01-01T00:00:00.000Z", registration_closes_at: "2032-06-10T00:00:00.000Z" });

      const listed = must(await who.chen.client.rpc("list_public_events")) as { id: string }[];
      const attempt = await who.chen.client.rpc("register_for_event", { p_event_id: eventId, p_details: DETAILS });

      expect(listed.map((e) => e.id)).toContain(eventId);
      expect(attempt.error).toBeNull();
    });
  });

  describe("185-S4b the coordinator adjusts registration", () => {
    it("SCRUM-185/AC4 185-S4b: the new capacity and window are saved, returned and logged, in any open status", async () => {
      for (const status of ["planning", "confirmed", "awaiting_arrangements"]) {
        const eventId = await eventIn(status);
        for (const key of CONFIRMED_ATTENDEES) await register(eventId, key, "registered");

        const { data, error } = await update(who.coordinator, eventId);

        expect(error).toBeNull();
        expect((data as { registration_capacity: number }[])[0]).toMatchObject({ registration_capacity: 40 });
        const saved = await settingsOf(eventId);
        expect(saved.registration_capacity).toBe(40);
        expect(new Date(saved.registration_opens_at as string).toISOString()).toBe(NEW.p_opens);
        expect(new Date(saved.registration_closes_at as string).toISOString()).toBe(NEW.p_closes);
        const log = must(await admin.from("activity_log").select("actor_id, action_type, description").eq("entity_id", eventId));
        expect(log).toHaveLength(1);
        expect(log[0]).toMatchObject({ actor_id: who.coordinator.userId, action_type: "registration_settings_changed" });
        expect(log[0].description).toContain("capacity 100 to 40");
      }
    });

    it("SCRUM-185/AC4 185-S4b: the registrations themselves are left alone", async () => {
      const eventId = await eventIn("planning");
      await register(eventId, "alicia", "registered");
      await register(eventId, "bryan", "waitlisted");
      const before = await registrationsOf(eventId);

      await update(who.coordinator, eventId);

      expect(await registrationsOf(eventId)).toEqual(before);
    });

    it("SCRUM-185/AC4 185-S4b: a closing time in the past closes registration, which is how a coordinator pauses it", async () => {
      const eventId = await eventIn("confirmed", { registration_opens_at: "2020-01-01T00:00:00.000Z", registration_closes_at: "2032-06-10T00:00:00.000Z" });
      const closed = { p_capacity: 100, p_opens: "2020-01-01T00:00:00.000Z", p_closes: "2020-02-01T00:00:00.000Z" };

      expect((await update(who.coordinator, eventId, closed)).error).toBeNull();

      expect((await who.chen.client.rpc("register_for_event", { p_event_id: eventId, p_details: DETAILS })).error?.code).toBe("CS169");
    });
  });

  describe("185-S4c the capacity cannot cut out someone who holds a place", () => {
    it("SCRUM-185/AC4 185-S4c: below the Confirmed registrations is refused on the capacity field; nothing changes", async () => {
      const eventId = await eventIn("planning");
      for (const key of CONFIRMED_ATTENDEES) await register(eventId, key, "registered");

      const { error } = await update(who.coordinator, eventId, { ...NEW, p_capacity: 4 });

      expect(error?.code).toBe("22023");
      expect(error?.hint).toBe("registration_capacity");
      expect(error?.message).toContain("5");
      expect((await settingsOf(eventId)).registration_capacity).toBe(100);
    });

    it("SCRUM-185/AC4 185-S4c: exactly the Confirmed registrations is allowed, and Pending ones do not count", async () => {
      const eventId = await eventIn("planning");
      for (const key of CONFIRMED_ATTENDEES) await register(eventId, key, "registered");
      await register(eventId, "farhana", "waitlisted");

      const { error } = await update(who.coordinator, eventId, { ...NEW, p_capacity: 5 });

      expect(error).toBeNull();
      expect((await settingsOf(eventId)).registration_capacity).toBe(5);
    });
  });

  describe("185-S4d the window must make sense", () => {
    it.each([
      ["a capacity of zero", { p_capacity: 0 }, "registration_capacity"],
      ["no capacity", { p_capacity: null }, "registration_capacity"],
      ["a closing time equal to the opening time", { p_closes: NEW.p_opens }, "registration_closes_at"],
      ["a closing time before the opening time", { p_closes: "2032-04-01T00:00:00.000Z" }, "registration_closes_at"],
      ["a closing time after the event starts", { p_closes: "2032-06-16T00:00:00.000Z" }, "registration_closes_at"],
      ["no opening time", { p_opens: null }, "registration_opens_at"],
      ["no closing time", { p_closes: null }, "registration_closes_at"],
    ])("SCRUM-185/AC4 185-S4d: %s is refused on its own field and nothing changes", async (_label, change, field) => {
      const eventId = await eventIn("planning");

      const { error } = await update(who.coordinator, eventId, { ...NEW, ...change });

      expect(error?.code).toBe("22023");
      expect(error?.hint).toBe(field);
      expect((await settingsOf(eventId)).registration_capacity).toBe(100);
    });
  });

  describe("185-S4e only the assigned coordinator", () => {
    it.each(["otherCoordinator", "organiser", "lead", "venueStaff", "alicia"] as const)("SCRUM-185/AC4 185-S4e: %s is refused and nothing changes", async (key) => {
      const eventId = await eventIn("planning");

      const { error } = await update(who[key], eventId);

      expect(error?.code).toBe(DENIED);
      expect((await settingsOf(eventId)).registration_capacity).toBe(100);
      expect(must(await admin.from("activity_log").select("id").eq("entity_id", eventId))).toEqual([]);
    });

    it("SCRUM-185/AC4 185-S4e: an unknown event is not found", async () => {
      const { error } = await update(who.coordinator, randomUUID());
      expect(error?.code).toBe("P0002");
    });
  });

  describe("185-S4f closed events and events without registration", () => {
    it.each(["completed", "cancelled", "rejected"])("SCRUM-185/AC4 185-S4f: a %s event is locked", async (status) => {
      const eventId = await eventIn(status);

      const { error } = await update(who.coordinator, eventId);

      expect(error?.code).toBe("CL001");
      expect((await settingsOf(eventId)).registration_capacity).toBe(100);
    });

    it("SCRUM-185/AC4 185-S4f: an event that does not take registrations is refused with its own message", async () => {
      const eventId = await eventIn("planning", { registration_required: false, registration_capacity: null, registration_opens_at: null, registration_closes_at: null });

      const { error } = await update(who.coordinator, eventId);

      expect(error?.code).toBe("22023");
      expect(error?.hint).toBe("registration");
    });
  });
});
