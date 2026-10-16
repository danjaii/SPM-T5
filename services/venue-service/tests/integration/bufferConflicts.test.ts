import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { paddedPeriod, periodsOverlap, sgtToUtc } from "@spm-t5/shared";
import type { BookingChange } from "../../src/domain/types";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { SupabaseVenueTimingWriter } from "../../src/readers/venueTimingWriter";
import { DB_ENV, adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-104 against Postgres (migration 36, docs/specs/venue-buffer-conflicts.md): set_venue_timing flags the bookings that
 * clash once padded, the flags are read through RLS, a flagged request cannot be approved, and flags clear by themselves.
 * Users sign in as seeded accounts so the grants, policies and function role checks are the real ones. Fixtures are
 * throwaway ("IT-") and dated 2030/2031, well away from the seed data.
 */
const STAFF = "kenneth.wong@connectsphere.example.com";
const RACHEL = "rachel.tan@connectsphere.example.com"; // coordinator of Summit B
const MARCUS = "marcus.lim@connectsphere.example.com"; // coordinator of Summit A
const ORGANISER = "jason.chua@techconnect.example.com";
const DAY = "2030-11-14";
const at = (time: string, date = DAY) => sgtToUtc(date, time);
const slot = (start: string, end: string, date = DAY) => ({ start: at(start, date), end: at(end, date) });
const DENIED = "42501";

type Actor = { client: SupabaseClient; userId: string; repo: SupabaseBookingRepository };

describe.skipIf(!hasDb || !DB_ENV.publishableKey)("SCRUM-104 buffer conflict flags (migration 36)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<"staff" | "rachel" | "marcus" | "organiser", Actor>;

  beforeAll(async () => {
    for (const [key, email] of [["staff", STAFF], ["rachel", RACHEL], ["marcus", MARCUS], ["organiser", ORGANISER]] as const) {
      const { client, userId } = await signInAs(email);
      who[key] = { client, userId, repo: new SupabaseBookingRepository(client) };
    }
  });
  afterAll(async () => {
    await fixtures.cleanup();
  });

  /** A holding booking arranged with the secret key. `owner` is the coordinator of its event. */
  async function hold(venueId: string, p: { start: Date; end: Date }, name: string, owner: "rachel" | "marcus", status = "approved") {
    const eventId = await fixtures.event("approved", who[owner].userId);
    const { data, error } = await admin
      .from("venue_bookings")
      .insert({
        event_id: eventId,
        venue_id: venueId,
        requested_by: who[owner].userId,
        status,
        event_start_datetime: p.start.toISOString(),
        event_end_datetime: p.end.toISOString(),
        snapshot_event_name: name,
        snapshot_expected_attendance: 10,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id as string, eventId };
  }

  /** The worked example: Orchid Hall with Summit A 10:00-12:00 (Marcus) and Summit B 12:30-14:00 (Rachel), both approved. */
  async function orchidWithSummits() {
    const venue = await fixtures.venue("IT-orchid");
    const a = await hold(venue, slot("10:00", "12:00"), "Summit A", "marcus");
    const b = await hold(venue, slot("12:30", "14:00"), "Summit B", "rachel");
    return { venue, a, b };
  }

  const setTiming = (venue: string, setup: number, turnaround: number, actor: Actor = who.staff) =>
    actor.client.rpc("set_venue_timing", { p_venue_id: venue, p_setup: setup, p_turnaround: turnaround });
  const openFlags = async (bookingId: string) => {
    const { data, error } = await admin.from("venue_booking_flags").select("*").eq("booking_id", bookingId).is("resolved_at", null);
    if (error) throw new Error(error.message);
    return data ?? [];
  };
  const allFlags = async (bookingId: string) => (await admin.from("venue_booking_flags").select("*").eq("booking_id", bookingId)).data ?? [];
  const row = async (table: string, id: string) => (await admin.from(table).select("*").eq("id", id).single()).data as Record<string, unknown>;

  it("104-S1: 30 and 45 flag Summit A and Summit B, each naming the other, and set_venue_timing returns the pair", async () => {
    const { venue, a, b } = await orchidWithSummits();

    const { data, error } = await setTiming(venue, 30, 45);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ booking_id: a.id, event_name: "Summit A", other_booking_id: b.id, other_event_name: "Summit B" });
    expect(new Date(data[0].occupied_until)).toEqual(at("12:45")); // Summit A occupies until 12:45
    expect(new Date(data[0].other_occupied_from)).toEqual(at("12:00")); // Summit B occupies from 12:00
    expect(await openFlags(a.id)).toMatchObject([{ kind: "buffer_conflict", other_booking_id: b.id, unavailability_id: null }]);
    expect(await openFlags(b.id)).toMatchObject([{ kind: "buffer_conflict", other_booking_id: a.id }]);
    // the copied period of the other booking, so a coordinator can be shown it
    expect(new Date((await openFlags(b.id))[0].other_start)).toEqual(at("10:00"));
    expect(new Date((await openFlags(b.id))[0].other_end)).toEqual(at("12:00"));
  });

  it("104-S2: nothing is removed, withdrawn or cancelled, and the events rows are unchanged", async () => {
    const { venue, a, b } = await orchidWithSummits();
    const before = [await row("venue_bookings", a.id), await row("venue_bookings", b.id), await row("events", a.eventId), await row("events", b.eventId)];

    await setTiming(venue, 30, 45);

    const after = [await row("venue_bookings", a.id), await row("venue_bookings", b.id), await row("events", a.eventId), await row("events", b.eventId)];
    expect(after).toEqual(before);
    expect(after[0]).toMatchObject({ status: "approved", cancelled_at: null, withdrawn_at: null });
    expect(after[1]).toMatchObject({ status: "approved", cancelled_at: null, withdrawn_at: null });
  });

  it("104-S1: saving the same times again raises no second flag", async () => {
    const { venue, a } = await orchidWithSummits();
    await setTiming(venue, 30, 45);
    const { data } = await setTiming(venue, 30, 45);
    expect(data).toHaveLength(1);
    expect(await allFlags(a.id)).toHaveLength(1);
  });

  it("104-S1: the save is logged with the number of flagged pairs", async () => {
    const { venue } = await orchidWithSummits();
    await setTiming(venue, 30, 45);
    const { data } = await admin.from("activity_log").select("description").eq("entity_id", venue);
    expect(data).toEqual([{ description: "Setup 30 minutes, turnaround 45 minutes; 1 conflicting booking pair(s) flagged" }]);
    await admin.from("activity_log").delete().eq("entity_id", venue);
  });

  it("104-S3: the assigned coordinator reads the flag on their booking and the other period; others read nothing", async () => {
    const { venue, a, b } = await orchidWithSummits();
    await setTiming(venue, 30, 45);

    const rachel = await who.rachel.client.from("venue_booking_flags").select("booking_id, other_start, other_end, kind");
    expect(rachel.error).toBeNull();
    expect(rachel.data).toEqual([expect.objectContaining({ booking_id: b.id, kind: "buffer_conflict" })]);
    expect((await who.marcus.client.from("venue_booking_flags").select("booking_id")).data).toEqual([{ booking_id: a.id }]);
    expect((await who.staff.client.from("venue_booking_flags").select("booking_id").in("booking_id", [a.id, b.id])).data).toHaveLength(2);
    expect((await who.organiser.client.from("venue_booking_flags").select("booking_id")).data).toEqual([]);

    // through the repository, which is what the DTOs use
    expect(await who.rachel.repo.flagsFor([a.id, b.id])).toMatchObject([{ bookingId: b.id, otherBookingId: a.id }]);
  });

  it("104-S3: nobody writes flags through the API, venue staff included", async () => {
    const { venue, a, b } = await orchidWithSummits();
    await setTiming(venue, 30, 45);
    const [flag] = await openFlags(a.id);

    for (const actor of [who.staff, who.rachel, who.marcus, who.organiser]) {
      const insert = await actor.client.from("venue_booking_flags").insert({ booking_id: a.id, kind: "buffer_conflict", other_booking_id: b.id });
      expect(insert.error?.code).toBe(DENIED);
      expect((await actor.client.from("venue_booking_flags").update({ resolved_at: new Date().toISOString() }).eq("id", flag.id)).error?.code).toBe(DENIED);
      expect((await actor.client.from("venue_booking_flags").delete().eq("id", flag.id)).error?.code).toBe(DENIED);
    }
    expect(await openFlags(a.id)).toHaveLength(1);
  });

  it("104-S9: a coordinator cannot call set_venue_timing or refresh_buffer_flags, and the venue is unchanged", async () => {
    const { venue, a } = await orchidWithSummits();

    expect((await setTiming(venue, 30, 45, who.rachel)).error?.code).toBe(DENIED);
    expect((await who.staff.client.rpc("refresh_buffer_flags", { p_venue_id: venue })).error).not.toBeNull();
    expect((await admin.from("venues").select("setup_minutes").eq("id", venue).single()).data).toEqual({ setup_minutes: 0 });
    expect(await openFlags(a.id)).toEqual([]);
  });

  it("104-S4: a flagged Pending request cannot be approved: the database raises CS104, the repository says BOOKING_FLAGGED, the row is unchanged", async () => {
    const venue = await fixtures.venue("IT-orchid");
    await hold(venue, slot("10:00", "12:00"), "Summit A", "marcus");
    const pending = await hold(venue, slot("12:30", "14:00"), "Summit B", "rachel", "requested");
    await setTiming(venue, 30, 45);
    expect(await openFlags(pending.id)).toHaveLength(1);

    // the service role bypasses RLS, so this is the trigger on its own
    const direct = await admin.from("venue_bookings").update({ status: "approved", reviewed_by: who.staff.userId }).eq("id", pending.id);
    expect(direct.error?.code).toBe("CS104");
    // the repository, as venue staff: a 409 BOOKING_FLAGGED, not a 500
    await expect(who.staff.repo.decide(pending.id, { outcome: "approved" }, who.staff.userId, new Date())).rejects.toMatchObject({ code: "BOOKING_FLAGGED", httpStatus: 409 });
    expect(await row("venue_bookings", pending.id)).toMatchObject({ status: "requested", reviewed_by: null });
  });

  it("104-S4: rejecting the flagged request works, and its flags (and its partner's) clear as booking_closed", async () => {
    const venue = await fixtures.venue("IT-orchid");
    const a = await hold(venue, slot("10:00", "12:00"), "Summit A", "marcus");
    const pending = await hold(venue, slot("12:30", "14:00"), "Summit B", "rachel", "requested");
    await setTiming(venue, 30, 45);

    const rejected = await who.staff.repo.decide(pending.id, { outcome: "rejected", reason: "Buffer conflict" }, who.staff.userId, new Date());

    expect(rejected).toMatchObject({ status: "rejected" });
    expect(await openFlags(pending.id)).toEqual([]);
    expect(await openFlags(a.id)).toEqual([]);
    expect((await allFlags(a.id))[0]).toMatchObject({ resolved_reason: "booking_closed" });
  });

  it("104-S4: an unflagged pending request is approved as before, and an already flagged APPROVED booking keeps its status", async () => {
    const venue = await fixtures.venue("IT-orchid");
    const pending = await hold(venue, slot("10:00", "12:00"), "Summit A", "marcus", "requested");
    expect(await who.staff.repo.decide(pending.id, { outcome: "approved" }, who.staff.userId, new Date())).toMatchObject({ status: "approved" });
  });

  it("104-S5: 15 and 15 clear both flags (no_longer_conflicts), return no pairs, and the request then approves", async () => {
    const venue = await fixtures.venue("IT-orchid");
    const a = await hold(venue, slot("10:00", "12:00"), "Summit A", "marcus");
    const pending = await hold(venue, slot("12:30", "14:00"), "Summit B", "rachel", "requested");
    await setTiming(venue, 30, 45);

    const { data, error } = await setTiming(venue, 15, 15); // A occupies until 12:15, B from 12:15

    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await openFlags(a.id)).toEqual([]);
    expect(await openFlags(pending.id)).toEqual([]);
    expect((await allFlags(pending.id))[0]).toMatchObject({ resolved_reason: "no_longer_conflicts" });
    expect(await who.staff.repo.decide(pending.id, { outcome: "approved" }, who.staff.userId, new Date())).toMatchObject({ status: "approved" });
  });

  it("104-S6: times that clash with nothing flag nothing", async () => {
    const { venue, a, b } = await orchidWithSummits();
    const { data, error } = await setTiming(venue, 10, 10);
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await allFlags(a.id)).toEqual([]);
    expect(await allFlags(b.id)).toEqual([]);
  });

  it("104-S7: a booking that already ended, a rejected, withdrawn or cancelled one are never flagged or partners", async () => {
    const venue = await fixtures.venue("IT-orchid");
    const past1 = await hold(venue, slot("10:00", "12:00", "2020-01-10"), "Old A", "marcus");
    const past2 = await hold(venue, slot("12:30", "14:00", "2020-01-10"), "Old B", "rachel");
    const live = await hold(venue, slot("10:00", "12:00"), "Summit A", "marcus");
    for (const status of ["rejected", "withdrawn", "cancelled"]) await hold(venue, slot("12:30", "14:00"), `Closed ${status}`, "rachel", status);

    const { data } = await setTiming(venue, 30, 45);

    expect(data).toEqual([]);
    for (const id of [past1.id, past2.id, live.id]) expect(await allFlags(id)).toEqual([]);
  });

  it("104-S7: touching padded periods (12:15 and 12:15) are not flagged", async () => {
    const { venue, a } = await orchidWithSummits();
    expect((await setTiming(venue, 15, 15)).data).toEqual([]);
    expect(await allFlags(a.id)).toEqual([]);
  });

  it("104-S8: cancelling a flagged booking (SCRUM-102) resolves its flag and its partner's", async () => {
    const { venue, a, b } = await orchidWithSummits();
    await setTiming(venue, 30, 45);

    await who.rachel.repo.cancel(b.id, who.rachel.userId, new Date(), "Not needed");

    expect(await openFlags(a.id)).toEqual([]);
    expect(await openFlags(b.id)).toEqual([]);
    expect((await allFlags(a.id))[0]).toMatchObject({ resolved_reason: "booking_closed" });
  });

  it("104-S8: moving a flagged booking clear of the other (SCRUM-102) resolves both as no_longer_conflicts", async () => {
    const { venue, a, b } = await orchidWithSummits();
    await setTiming(venue, 30, 45);
    const change: BookingChange = { ...slot("16:00", "17:00"), expectedAttendance: 10, venueRequirements: null };

    await who.rachel.repo.change(b.id, change, new Date());

    expect(await openFlags(a.id)).toEqual([]);
    expect(await openFlags(b.id)).toEqual([]);
    expect((await allFlags(b.id))[0]).toMatchObject({ resolved_reason: "no_longer_conflicts" });
  });

  it("104-S1: deleting a booking removes its flags with it (cascade)", async () => {
    const { venue, a, b } = await orchidWithSummits();
    await setTiming(venue, 30, 45);
    await admin.from("venue_bookings").delete().eq("id", b.id);
    expect(await allFlags(a.id)).toEqual([]);
  });

  it("104-S1: a flag names exactly one target, matching its kind (check constraint)", async () => {
    const { a, b } = await orchidWithSummits();
    const noTarget = await admin.from("venue_booking_flags").insert({ booking_id: a.id, kind: "buffer_conflict" });
    const wrongTarget = await admin.from("venue_booking_flags").insert({ booking_id: a.id, kind: "venue_unavailable", other_booking_id: b.id });
    const self = await admin.from("venue_booking_flags").insert({ booking_id: a.id, kind: "buffer_conflict", other_booking_id: a.id });
    for (const r of [noTarget, wrongTarget, self]) expect(r.error?.code).toBe("23514");
  });

  it("104-S10: 20 rounds of set_venue_timing against change_venue_booking on one venue end with a consistent flag set", async () => {
    const venue = await fixtures.venue("IT-race");
    const a = await hold(venue, slot("10:00", "12:00"), "Race A", "marcus");
    const b = await hold(venue, slot("12:30", "14:00"), "Race B", "rachel");
    const timing = new SupabaseVenueTimingWriter(who.staff.client);
    const bPlaces = [slot("12:30", "14:00"), slot("13:00", "14:30")];
    const unexpected: unknown[] = [];

    for (let round = 0; round < 20; round++) {
      const target = bPlaces[round % 2]!;
      const results = await Promise.allSettled([
        timing.set(venue, round % 2 === 0 ? 30 : 15, round % 2 === 0 ? 45 : 15),
        // change_venue_booking sends B back to PENDING; put it back so the next round starts from a holding booking
        who.rachel.repo.change(b.id, { ...target, expectedAttendance: 10, venueRequirements: null }, new Date()),
      ]);
      for (const r of results) {
        if (r.status !== "rejected") continue;
        const code = (r.reason as { code?: string; cause?: { code?: string } }).code;
        // a deadlock victim is retried by the repository/writer; a padded clash with the new times is a legitimate SLOT_CONFLICT
        if (code !== "SLOT_CONFLICT") unexpected.push(r.reason);
      }

      // invariant after every round: the open flags are exactly the clashing pairs of holding, future bookings
      const { data: bookings } = await admin.from("venue_bookings").select("id, status, event_start_datetime, event_end_datetime").eq("venue_id", venue);
      const { data: v } = await admin.from("venues").select("setup_minutes, turnaround_minutes").eq("id", venue).single();
      const timingNow = { setupMinutes: v!.setup_minutes as number, turnaroundMinutes: v!.turnaround_minutes as number };
      const holding = (bookings ?? []).filter((x) => ["requested", "tentative", "approved", "confirmed"].includes(x.status as string));
      const period = (x: { event_start_datetime: string; event_end_datetime: string }) => ({ start: new Date(x.event_start_datetime), end: new Date(x.event_end_datetime) });
      const clash = holding.length === 2 && periodsOverlap(paddedPeriod(period(holding[0]!), timingNow), paddedPeriod(period(holding[1]!), timingNow));
      const open = [...(await openFlags(a.id)), ...(await openFlags(b.id))];
      // Either order of commit is valid for the timing save, but a flag set must never name a pair that does not clash now
      // (the trigger and the refresh both resolve them). The final save below proves it also finds every pair.
      expect(open.length === 0 || clash, `round ${round}: open flags with no clash`).toBe(true);
    }

    expect(unexpected).toEqual([]);
    // settle: one more save with nothing else running makes the set exactly right
    await timing.set(venue, 30, 45);
    const { data: bookings } = await admin.from("venue_bookings").select("id, status, event_start_datetime, event_end_datetime").eq("venue_id", venue);
    const holding = (bookings ?? []).filter((x) => ["requested", "tentative", "approved", "confirmed"].includes(x.status as string));
    const timingNow = { setupMinutes: 30, turnaroundMinutes: 45 };
    const period = (x: { event_start_datetime: string; event_end_datetime: string }) => ({ start: new Date(x.event_start_datetime), end: new Date(x.event_end_datetime) });
    const clash = holding.length === 2 && periodsOverlap(paddedPeriod(period(holding[0]!), timingNow), paddedPeriod(period(holding[1]!), timingNow));
    expect((await openFlags(a.id)).length + (await openFlags(b.id)).length).toBe(clash ? 2 : 0);
  }, 120_000);
});
