import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { SupabaseEventReader } from "../../src/readers/supabaseEventReader";
import { SupabaseVenueDetailsReader } from "../../src/readers/venueDetailsReader";
import { SupabaseVenueReader } from "../../src/readers/venueReader";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { BookingService } from "../../src/services/bookingService";
import { adminClient, DB_ENV, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-110 against real Postgres (migration 33): the suitability result is stored with the request, an unsuitable
 * request needs a reason, and nobody can change the result afterwards. Fixtures are prefixed "IT-" and cleaned up.
 */
const COORDINATOR = "rachel.tan@connectsphere.example.com";
const NOW = new Date("2026-10-14T00:00:00.000Z");

describe.skipIf(!hasDb)("SCRUM-110 suitability on a venue booking request against Postgres (migration 33)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  let coordinator: { client: Awaited<ReturnType<typeof signInAs>>["client"]; userId: string };

  const slot = (day: string) => ({
    event_start_datetime: sgtToUtc(`2031-06-${day}`, "09:00").toISOString(),
    event_end_datetime: sgtToUtc(`2031-06-${day}`, "12:00").toISOString(),
  });

  async function service() {
    const client = coordinator.client;
    return new BookingService({
      bookings: new SupabaseBookingRepository(client),
      events: new SupabaseEventReader(client),
      venues: new SupabaseVenueReader(client),
      venueDetails: new SupabaseVenueDetailsReader(client),
      now: () => NOW,
    });
  }

  async function eventFor120() {
    const id = await fixtures.event("approved", coordinator.userId);
    const { error } = await admin.from("events").update({ expected_attendance: 120 }).eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  }

  beforeAll(async () => {
    if (!DB_ENV.publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY must be set for the RLS tests (see README).");
    coordinator = await signInAs(COORDINATOR);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("110-S1 a suitable request stores suitability 'suitable' with nothing unmet", async () => {
    const venue = await fixtures.venue("IT-orchid", { max_capacity: 200 });
    const { booking } = await (await service()).submit(
      { id: coordinator.userId, role: "event_coordinator" },
      { eventId: await eventFor120(), venueId: venue, date: "2031-06-10", startTime: "09:00", endTime: "12:00" },
    );
    expect(booking).toMatchObject({ suitability: "suitable", suitabilityUnmet: [], suitabilityOverrideReason: null });
  });

  it("110-S2 an unsuitable venue is refused without a reason, and stored with the unmet list and reason when confirmed", async () => {
    const venue = await fixtures.venue("IT-lotus", { max_capacity: 60 });
    const eventId = await eventFor120();
    const caller = { id: coordinator.userId, role: "event_coordinator" as const };
    const body = { eventId, venueId: venue, date: "2031-06-11", startTime: "09:00", endTime: "12:00" };

    await expect((await service()).submit(caller, body)).rejects.toMatchObject({ code: "UNSUITABLE_VENUE", httpStatus: 409 });
    const { data: none } = await admin.from("venue_bookings").select("id").eq("event_id", eventId);
    expect(none).toEqual([]);

    const { booking } = await (await service()).submit(caller, { ...body, overrideReason: "Two smaller sessions" });
    expect(booking).toMatchObject({ suitability: "not_suitable", suitabilityOverrideReason: "Two smaller sessions" });
    expect(booking.suitabilityUnmet?.map((u) => u.key)).toEqual(["capacity"]);
  });

  it("110-S5 availability still blocks: an overlapping booking is SLOT_CONFLICT even with a reason", async () => {
    const venue = await fixtures.venue("IT-held", { max_capacity: 60 });
    const holder = await eventFor120();
    const { error } = await admin.from("venue_bookings").insert({
      event_id: holder,
      venue_id: venue,
      requested_by: coordinator.userId,
      status: "approved",
      ...slot("12"),
    });
    if (error) throw new Error(error.message);

    await expect(
      (await service()).submit(
        { id: coordinator.userId, role: "event_coordinator" },
        { eventId: await eventFor120(), venueId: venue, date: "2031-06-12", startTime: "10:00", endTime: "11:00", overrideReason: "Go on" },
      ),
    ).rejects.toMatchObject({ code: "SLOT_CONFLICT" });
  });

  it("110-S6 a booking is judged on its own attendance: 40 people fit a 60-seat venue though the event expects 120", async () => {
    const venue = await fixtures.venue("IT-breakout", { max_capacity: 60 });
    const { booking } = await (await service()).submit(
      { id: coordinator.userId, role: "event_coordinator" },
      { eventId: await eventFor120(), venueId: venue, date: "2031-06-15", startTime: "09:00", endTime: "12:00", expectedAttendance: 40 },
    );
    expect(booking).toMatchObject({ suitability: "suitable" });
    expect(booking.snapshot.expectedAttendance).toBe(40);
  });

  it("110-S10 change_venue_booking (migration 33) stores the result made afresh and clears the reason when it fits again", async () => {
    const venue = await fixtures.venue("IT-change", { max_capacity: 100 });
    const caller = { id: coordinator.userId, role: "event_coordinator" as const };
    const eventId = await eventFor120();
    const { booking } = await (await service()).submit(caller, {
      eventId, venueId: venue, date: "2031-06-16", startTime: "09:00", endTime: "12:00", expectedAttendance: 50,
    });
    expect(booking.suitability).toBe("suitable");
    const same = { date: "2031-06-16", startTime: "09:00", endTime: "12:00" };

    await expect((await service()).change(caller, booking.id, { ...same, expectedAttendance: 300 })).rejects.toMatchObject({
      code: "UNSUITABLE_VENUE",
    });
    const raised = await (await service()).change(caller, booking.id, { ...same, expectedAttendance: 300, overrideReason: "Overflow room" });
    expect(raised.booking).toMatchObject({ status: "requested", suitability: "not_suitable", suitabilityOverrideReason: "Overflow room" });

    const lowered = await (await service()).change(caller, booking.id, { ...same, expectedAttendance: 60 });
    expect(lowered.booking).toMatchObject({ suitability: "suitable", suitabilityUnmet: [], suitabilityOverrideReason: null });
  });

  it("DB: a not_suitable row without a reason is rejected by the check constraint, with one it is accepted", async () => {
    const venue = await fixtures.venue("IT-constraint");
    const row = { event_id: await fixtures.event("approved", coordinator.userId), venue_id: venue, requested_by: coordinator.userId, status: "requested", ...slot("13") };

    const bad = await admin.from("venue_bookings").insert({ ...row, suitability: "not_suitable" });
    expect(bad.error?.code).toBe("23514");
    const blank = await admin.from("venue_bookings").insert({ ...row, suitability: "not_suitable", suitability_override_reason: "   " });
    expect(blank.error?.code).toBe("23514");
    const good = await admin.from("venue_bookings").insert({ ...row, suitability: "not_suitable", suitability_override_reason: "Because" });
    expect(good.error).toBeNull();
  });

  it("DB: the coordinator cannot change the stored result afterwards (not in the UPDATE grant)", async () => {
    const venue = await fixtures.venue("IT-grant", { max_capacity: 200 });
    const { booking } = await (await service()).submit(
      { id: coordinator.userId, role: "event_coordinator" },
      { eventId: await eventFor120(), venueId: venue, date: "2031-06-14", startTime: "09:00", endTime: "12:00" },
    );
    const { error } = await coordinator.client
      .from("venue_bookings")
      .update({ suitability: "not_suitable", suitability_override_reason: "forged" })
      .eq("id", booking.id);
    expect(error).not.toBeNull();
    const { data } = await admin.from("venue_bookings").select("suitability").eq("id", booking.id).single();
    expect(data?.suitability).toBe("suitable");
  });
});
