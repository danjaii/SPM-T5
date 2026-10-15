import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sgtToUtc } from "@spm-t5/shared";
import type { NewBooking } from "../../src/domain/types";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { SlotConflictRule } from "../../src/services/slotConflictRule";
import { adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-103: padded occupancy against Postgres (migration 27). Coordinators and venue staff sign in as seeded users, so
 * RLS hides other coordinators' bookings from them exactly as it does in the app, which is what the security definer
 * functions and the trigger exist to see through. Fixtures are throwaway ("IT-") and dated 2030.
 */
const EMAILS = {
  coordinatorA: "rachel.tan@connectsphere.example.com",
  coordinatorB: "marcus.lim@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  technicalSupport: "aaron.koh@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
};
const DENIED = "42501";
const DAY = "2030-11-14";
const at = (time: string, date = DAY) => sgtToUtc(date, time);
const slot = (start: string, end: string, date = DAY) => ({ start: at(start, date), end: at(end, date) });

type Actor = { client: SupabaseClient; userId: string; repo: SupabaseBookingRepository };

describe.skipIf(!hasDb)("SCRUM-103 padded venue occupancy (migration 27)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<keyof typeof EMAILS, Actor>;

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as (keyof typeof EMAILS)[]) {
      const { client, userId } = await signInAs(EMAILS[key]);
      who[key] = { client, userId, repo: new SupabaseBookingRepository(client) };
    }
  });
  afterAll(async () => {
    await fixtures.cleanup();
  });

  /** Orchid Hall: setup 30, turnaround 45 (the customer's worked example). */
  const orchid = (setup = 30, turnaround = 45) =>
    fixtures.venue("IT-orchid", { setup_minutes: setup, turnaround_minutes: turnaround });

  /** A holding booking arranged with the secret key, so RLS never gets in the way. */
  async function hold(venueId: string, p: { start: Date; end: Date }, status = "approved", side: "coordinatorA" | "coordinatorB" = "coordinatorB") {
    const eventId = await fixtures.event("approved", who[side].userId);
    const { data, error } = await admin
      .from("venue_bookings")
      .insert({ event_id: eventId, venue_id: venueId, requested_by: who[side].userId, status, event_start_datetime: p.start.toISOString(), event_end_datetime: p.end.toISOString() })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id as string, eventId };
  }

  /** A request made as coordinator A for one of their own events, through RLS, like the app does. */
  async function request(venueId: string, p: { start: Date; end: Date }, side: "coordinatorA" | "coordinatorB" = "coordinatorA") {
    const input: NewBooking = {
      eventId: await fixtures.event("approved", who[side].userId),
      venueId,
      ...p,
      requestedBy: who[side].userId,
      snapshot: { eventName: "IT", expectedAttendance: 50, venueRequirements: null, accessibilityNeeds: null },
    };
    return who[side].repo.insert(input);
  }

  it("103-S1: venue_padded_period adds the setup before and the turnaround after", async () => {
    const venue = await orchid();
    const p = slot("10:00", "12:00");
    const { data, error } = await who.coordinatorA.client.rpc("venue_padded_period", { p_venue_id: venue, p_start: p.start.toISOString(), p_end: p.end.toISOString() });
    expect(error).toBeNull();
    expect(String(data)).toMatch(/2030-11-14 01:30:00\+00.*2030-11-14 04:45:00\+00/); // 09:30 to 12:45 Singapore
  });

  it("103-S1/S2/S3: 12:30 and 08:00-08:50 are refused, 13:15 and 08:00-08:45 are created (the worked example)", async () => {
    const venue = await orchid();
    await hold(venue, slot("10:00", "12:00"));

    await expect(request(venue, slot("12:30", "14:00"))).rejects.toMatchObject({ code: "SLOT_CONFLICT", httpStatus: 409 });
    await expect(request(venue, slot("08:00", "08:50"))).rejects.toMatchObject({ code: "SLOT_CONFLICT" });
    expect(await request(venue, slot("13:15", "15:00"))).toMatchObject({ status: "requested" });
    expect(await request(venue, slot("08:00", "08:45"))).toMatchObject({ status: "requested" });
  });

  it("103-S1: the rule names the occupied period of a hold the coordinator cannot see", async () => {
    const venue = await orchid();
    await hold(venue, slot("10:00", "12:00"));
    const rule = new SlotConflictRule(who.coordinatorA.repo);

    expect(await rule.findConflict(venue, at("12:30"), at("14:00"))).toMatchObject({
      status: "APPROVED",
      eventStart: at("10:00"),
      eventEnd: at("12:00"),
      occupiedStart: at("09:30"),
      occupiedEnd: at("12:45"),
      timing: { setupMinutes: 30, turnaroundMinutes: 45 },
    });
    expect(await rule.findConflict(venue, at("13:15"), at("15:00"))).toBeNull();
    await expect(rule.check(venue, at("12:30"), at("14:00"))).rejects.toMatchObject({
      message: expect.stringMatching(/^IT-orchid-\w+ is occupied from 09:30 to 12:45, including setup and turnaround$/),
    });
  });

  it("103-S4: a Pending request of another coordinator blocks the slot, though RLS hides it", async () => {
    const venue = await orchid();
    const { id } = await hold(venue, slot("10:00", "12:00"), "requested", "coordinatorB");
    const { data } = await who.coordinatorA.client.from("venue_bookings").select("id").eq("id", id);
    expect(data).toEqual([]); // really hidden from A

    await expect(request(venue, slot("12:30", "14:00"))).rejects.toMatchObject({ code: "SLOT_CONFLICT" });
  });

  it.each(["rejected", "withdrawn"])("103-S4: a %s request does not block", async (status) => {
    const venue = await orchid();
    await hold(venue, slot("10:00", "12:00"), status);
    expect(await request(venue, slot("12:30", "14:00"))).toMatchObject({ status: "requested" });
  });

  it("103-S6: with zero times, a request starting as another ends is created", async () => {
    const venue = await orchid(0, 0);
    await hold(venue, slot("09:00", "12:00"));
    expect(await request(venue, slot("12:00", "14:00"))).toMatchObject({ status: "requested" });
    await expect(request(venue, slot("11:59", "13:00"))).rejects.toMatchObject({ code: "SLOT_CONFLICT" });
  });

  it("103-S1: legacy tentative and confirmed holds pad too", async () => {
    for (const status of ["tentative", "confirmed"]) {
      const venue = await orchid();
      await hold(venue, slot("10:00", "12:00"), status);
      await expect(request(venue, slot("12:30", "14:00"))).rejects.toMatchObject({ code: "SLOT_CONFLICT" });
    }
  });

  it("103-S1: the current times apply, so raising them refuses a slot that was free", async () => {
    const venue = await orchid(0, 0);
    await hold(venue, slot("10:00", "12:00"));
    await admin.from("venues").update({ setup_minutes: 30, turnaround_minutes: 45 }).eq("id", venue);
    await expect(request(venue, slot("12:30", "14:00"))).rejects.toMatchObject({ code: "SLOT_CONFLICT" });
  });

  it("103-S1: approving a request still works after the padding is raised", async () => {
    const venue = await orchid(0, 0);
    const { id } = await hold(venue, slot("10:00", "12:00"), "requested");
    await hold(venue, slot("12:00", "14:00"), "approved"); // touches while the times are 0
    await admin.from("venues").update({ setup_minutes: 30, turnaround_minutes: 45 }).eq("id", venue);

    const decided = await who.venueStaff.repo.decide(id, { outcome: "approved" }, who.venueStaff.userId, new Date());

    expect(decided).toMatchObject({ status: "approved" });
  });

  it("103-S1: the stored period of a hold cannot be moved onto another hold", async () => {
    const venue = await orchid();
    await hold(venue, slot("10:00", "12:00"));
    const { id } = await hold(venue, slot("15:00", "16:00"));
    const { error } = await admin.from("venue_bookings").update({ event_start_datetime: at("12:30").toISOString(), event_end_datetime: at("14:00").toISOString() }).eq("id", id);
    expect(error?.code).toBe("23P01");
  });

  it("103-S1: two coordinators racing for padded-conflicting slots leave exactly one request (repeated)", async () => {
    for (let run = 0; run < 20; run++) {
      const venue = await orchid();
      const [eventA, eventB] = [await fixtures.event("approved", who.coordinatorA.userId), await fixtures.event("approved", who.coordinatorB.userId)];
      const input = (eventId: string, side: "coordinatorA" | "coordinatorB", p: { start: Date; end: Date }): NewBooking => ({
        eventId, venueId: venue, ...p, requestedBy: who[side].userId,
        snapshot: { eventName: "IT", expectedAttendance: 50, venueRequirements: null, accessibilityNeeds: null },
      });

      // 10:00-12:00 occupies 09:30-12:45 and 12:30-14:00 occupies 12:00-14:45: they overlap only through the padding.
      const results = await Promise.allSettled([
        who.coordinatorA.repo.insert(input(eventA, "coordinatorA", slot("10:00", "12:00", "2030-12-01"))),
        who.coordinatorB.repo.insert(input(eventB, "coordinatorB", slot("12:30", "14:00", "2030-12-01"))),
      ]);

      expect(results.filter((r) => r.status === "fulfilled"), `run ${run}`).toHaveLength(1);
      const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(rejected?.reason).toMatchObject({ code: "SLOT_CONFLICT" });
      const { count } = await admin.from("venue_bookings").select("id", { count: "exact", head: true }).eq("venue_id", venue);
      expect(count, `run ${run}`).toBe(1);
    }
  }, 120_000);

  describe("the availability, the search and the pre-check agree (103-S5)", () => {
    it("103-S5: venue_occupied_periods returns the event and the padded period, and nothing that identifies the holder", async () => {
      const venue = await orchid();
      await hold(venue, slot("10:00", "12:00"));

      const from = at("00:00");
      const to = at("23:59");
      const rows = await who.coordinatorA.repo.occupiedPeriods(venue, from, to);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ eventStart: at("10:00"), eventEnd: at("12:00"), occupiedStart: at("09:30"), occupiedEnd: at("12:45"), status: "APPROVED" });
      const { data } = await who.coordinatorA.client.rpc("venue_occupied_periods", { p_venue_id: venue, p_from: from.toISOString(), p_to: to.toISOString() });
      expect(Object.keys(data[0]).sort()).toEqual(
        ["event_end", "event_start", "occupied_end", "occupied_start", "setup_minutes", "status", "turnaround_minutes", "venue_name"],
      );
    });

    it("103-S5: a booking whose padding only reaches into the window is listed; one beyond it is not", async () => {
      const venue = await orchid();
      await hold(venue, slot("10:00", "12:00")); // occupies until 12:45
      expect(await who.coordinatorA.repo.occupiedPeriods(venue, at("12:30"), at("13:00"))).toHaveLength(1);
      expect(await who.coordinatorA.repo.occupiedPeriods(venue, at("12:45"), at("13:00"))).toHaveLength(0);
    });

    it("103-S5: venue_slot_is_held, available_venues and the conflict check give the same answer for both slots", async () => {
      const venue = await orchid();
      await hold(venue, slot("10:00", "12:00"));

      for (const [start, end, blocked] of [["12:30", "14:00", true], ["13:15", "15:00", false]] as const) {
        const p = slot(start, end);
        expect(await who.coordinatorA.repo.hasHold(venue, p.start, p.end), `${start} held`).toBe(blocked);
        expect((await who.coordinatorA.repo.slotConflicts(venue, p.start, p.end)).length > 0, `${start} conflicts`).toBe(blocked);
        const { data } = await who.coordinatorA.client.rpc("available_venues", { p_start: p.start.toISOString(), p_end: p.end.toISOString() });
        expect((data as string[]).includes(venue), `${start} listed as free`).toBe(!blocked);
      }
    });

    it("103-S5: the period functions refuse anyone but coordinators and venue staff", async () => {
      const venue = await orchid();
      const p = slot("12:30", "14:00");
      for (const actor of [who.technicalSupport, who.attendee]) {
        const conflicts = await actor.client.rpc("venue_slot_conflicts", { p_venue_id: venue, p_start: p.start.toISOString(), p_end: p.end.toISOString() });
        const occupied = await actor.client.rpc("venue_occupied_periods", { p_venue_id: venue, p_from: p.start.toISOString(), p_to: p.end.toISOString() });
        expect(conflicts.error?.code).toBe(DENIED);
        expect(occupied.error?.code).toBe(DENIED);
      }
      // venue staff may look
      expect((await who.venueStaff.repo.occupiedPeriods(venue, p.start, p.end))).toEqual([]);
    });
  });

  describe("changing one booking and several bookings per event (SCRUM-102, SCRUM-98; 103-S8, 103-S9)", () => {
    const change = (p: { start: Date; end: Date }, attendance: number | null = 50) => ({ ...p, expectedAttendance: attendance, venueRequirements: null });

    /** The coordinator A's own booking at the venue, arranged directly, so change_venue_booking() is what is tested. */
    async function ownBooking(venueId: string, p: { start: Date; end: Date }, status = "requested") {
      const eventId = await fixtures.event("approved", who.coordinatorA.userId);
      const { data, error } = await admin
        .from("venue_bookings")
        .insert({ event_id: eventId, venue_id: venueId, requested_by: who.coordinatorA.userId, status, event_start_datetime: p.start.toISOString(), event_end_datetime: p.end.toISOString(), snapshot_expected_attendance: 50 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: data.id as string, eventId };
    }

    it("103-S8: change_venue_booking into a padded clash with another event's hold is SLOT_CONFLICT, and nothing changes", async () => {
      const venue = await orchid();
      await hold(venue, slot("10:00", "12:00"));
      const mine = await ownBooking(venue, slot("16:00", "17:00"));

      await expect(who.coordinatorA.repo.change(mine.id, change(slot("12:30", "14:00")))).rejects.toMatchObject({ code: "SLOT_CONFLICT" });

      const { data } = await admin.from("venue_bookings").select("event_start_datetime, status").eq("id", mine.id).single();
      expect(new Date(data!.event_start_datetime as string)).toEqual(at("16:00"));
      expect(data!.status).toBe("requested");
    });

    it("103-S8: moving to where the padded periods only touch works, and an approved booking goes back to PENDING", async () => {
      const venue = await orchid();
      await hold(venue, slot("10:00", "12:00"));
      const mine = await ownBooking(venue, slot("16:00", "17:00"), "approved");

      const changed = await who.coordinatorA.repo.change(mine.id, change(slot("13:15", "15:00")));

      expect(changed).toMatchObject({ status: "requested", start: at("13:15"), end: at("15:00") });
    });

    it("103-S8: a booking may move within its own padding (it does not conflict with itself)", async () => {
      const venue = await orchid();
      const mine = await ownBooking(venue, slot("16:00", "17:00"));
      expect(await who.coordinatorA.repo.change(mine.id, change(slot("16:30", "17:30")))).toMatchObject({ start: at("16:30") });
    });

    it("103-S8: changing only the numbers still works after the venue's padding was raised over a neighbour", async () => {
      const venue = await orchid(0, 0);
      await hold(venue, slot("12:00", "14:00")); // touches while the times are 0
      const mine = await ownBooking(venue, slot("10:00", "12:00"));
      await admin.from("venues").update({ setup_minutes: 30, turnaround_minutes: 45 }).eq("id", venue);

      const changed = await who.coordinatorA.repo.change(mine.id, change(slot("10:00", "12:00"), 80));

      expect(changed).toMatchObject({ status: "requested", snapshot: { expectedAttendance: 80 } });
    });

    it("103-S9: two bookings of one event at one venue cannot be padded-close either (DUPLICATE_VENUE is the service's, the trigger is the guarantee)", async () => {
      const venue = await orchid();
      const eventId = await fixtures.event("approved", who.coordinatorA.userId);
      const insert = (p: { start: Date; end: Date }) =>
        admin.from("venue_bookings").insert({ event_id: eventId, venue_id: venue, requested_by: who.coordinatorA.userId, status: "requested", event_start_datetime: p.start.toISOString(), event_end_datetime: p.end.toISOString() });

      expect((await insert(slot("10:00", "12:00"))).error).toBeNull();
      expect((await insert(slot("12:30", "14:00"))).error?.code).toBe("23P01");
      expect((await insert(slot("13:15", "15:00"))).error).toBeNull(); // touches only
    });

    it("103-S9: one event may hold different venues at the same time", async () => {
      const [venueA, venueB] = [await orchid(), await orchid()];
      const eventId = await fixtures.event("approved", who.coordinatorA.userId);
      for (const venue of [venueA, venueB]) {
        const { error } = await admin.from("venue_bookings").insert({ event_id: eventId, venue_id: venue, requested_by: who.coordinatorA.userId, status: "requested", event_start_datetime: at("10:00").toISOString(), event_end_datetime: at("12:00").toISOString() });
        expect(error).toBeNull();
      }
    });
  });
});
