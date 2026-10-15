import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import type { BookingChange } from "../../src/domain/types";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { DB_ENV, adminClient, Fixtures, hasDb, signInAs } from "./support/db";

// ----------------------------------------------------------------------------
// SCRUM-102 against Postgres: change_venue_booking() and cancel_venue_booking() (migration 30), called as a signed-in
// coordinator so the functions' own checks are what is tested (docs/specs/change-cancel-venue-booking.md).
// Fixtures are made with the secret key and removed afterwards. Dates in 2031 keep them away from the seed data.
// ----------------------------------------------------------------------------

const RACHEL = "rachel.tan@connectsphere.example.com"; // the event's coordinator in these tests
const MARCUS = "marcus.lim@connectsphere.example.com"; // another coordinator

const at = (date: string, start: string, end: string) => ({ start: sgtToUtc(date, start), end: sgtToUtc(date, end) });

describe.skipIf(!hasDb || !DB_ENV.publishableKey)("SCRUM-102 change and cancel against Postgres (migration 30)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  let rachel: { repo: SupabaseBookingRepository; userId: string };
  let marcus: { repo: SupabaseBookingRepository; userId: string };
  let equipmentId: string;

  beforeAll(async () => {
    const r = await signInAs(RACHEL);
    const m = await signInAs(MARCUS);
    rachel = { repo: new SupabaseBookingRepository(r.client), userId: r.userId };
    marcus = { repo: new SupabaseBookingRepository(m.client), userId: m.userId };
    const { data, error } = await admin.from("equipment").select("id").limit(1).single();
    if (error) throw new Error(`Need seeded equipment (run supabase db reset): ${error.message}`);
    equipmentId = data.id as string;
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  /** A venue booking for the event, inserted directly (not under test), with optional setup and teardown. */
  async function venueBooking(eventId: string, venueId: string, period: { start: Date; end: Date }, extra: Record<string, unknown> = {}) {
    const { data, error } = await admin
      .from("venue_bookings")
      .insert({
        event_id: eventId,
        venue_id: venueId,
        requested_by: rachel.userId,
        status: "requested",
        event_start_datetime: period.start.toISOString(),
        event_end_datetime: period.end.toISOString(),
        snapshot_expected_attendance: 50,
        ...extra,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  /** An equipment request for the event, linked to a venue booking (or to none), copying its period like SCRUM-86 does. */
  async function equipmentRequest(eventId: string, venueBookingId: string | null, period: { start: Date; end: Date }, status = "requested") {
    const { data, error } = await admin
      .from("equipment_reservations")
      .insert({
        event_id: eventId,
        equipment_id: equipmentId,
        quantity_requested: 2,
        quantity_reserved: status === "approved" ? 2 : null,
        status,
        requested_by: rachel.userId,
        start_datetime: period.start.toISOString(),
        end_datetime: period.end.toISOString(),
        venue_booking_id: venueBookingId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  const row = async (table: string, id: string) => {
    const { data, error } = await admin.from(table).select("*").eq("id", id).single();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  };

  const change = (period: { start: Date; end: Date }, extra: Partial<BookingChange> = {}): BookingChange => ({
    ...period,
    expectedAttendance: 50,
    venueRequirements: null,
    ...extra,
  });

  // ----------------------------------------------------------------------------
  // AC1: change one venue booking
  // ----------------------------------------------------------------------------

  // an approved venue booking 9am-12pm with a 1-hour setup and a 30-minute teardown moves to 10am-1pm, which overlaps its
  // own old period
  it("102-S2, S6: an approved venue booking takes the new period, is PENDING again with its decision cleared, and keeps its setup and teardown buffers", async () => {
    const event = await fixtures.event("planning", rachel.userId);
    const old = at("2031-03-03", "09:00", "12:00");
    const id = await venueBooking(event, await fixtures.venue(), old, {
      status: "approved",
      reviewed_by: marcus.userId,
      reviewed_at: new Date().toISOString(),
      review_notes: "Fine",
      setup_start_datetime: sgtToUtc("2031-03-03", "08:00").toISOString(),
      teardown_end_datetime: sgtToUtc("2031-03-03", "12:30").toISOString(),
    });

    const changed = await rachel.repo.change(id, change(at("2031-03-03", "10:00", "13:00"), { expectedAttendance: 80 }), new Date());

    expect(changed).toMatchObject({ status: "requested", reviewedBy: null, reviewedAt: null, reviewNotes: null });
    const saved = await row("venue_bookings", id);
    expect(new Date(saved.event_start_datetime as string)).toEqual(sgtToUtc("2031-03-03", "10:00"));
    expect(new Date(saved.setup_start_datetime as string)).toEqual(sgtToUtc("2031-03-03", "09:00"));
    expect(new Date(saved.teardown_end_datetime as string)).toEqual(sgtToUtc("2031-03-03", "13:30"));
    expect(saved.snapshot_expected_attendance).toBe(80);
  });

  // another event holds the venue 2pm-4pm
  it("102-S4: changing to a period another event holds at that venue is SLOT_CONFLICT, and nothing changes", async () => {
    const venue = await fixtures.venue();
    await venueBooking(await fixtures.event("planning", rachel.userId), venue, at("2031-03-04", "14:00", "16:00"));
    const id = await venueBooking(await fixtures.event("planning", rachel.userId), venue, at("2031-03-04", "09:00", "12:00"));

    await expect(rachel.repo.change(id, change(at("2031-03-04", "15:00", "18:00")), new Date())).rejects.toMatchObject({ code: "SLOT_CONFLICT" });
    expect(new Date((await row("venue_bookings", id)).event_start_datetime as string)).toEqual(sgtToUtc("2031-03-04", "09:00"));
  });

  it("102-S11: a rejected venue booking is not changed", async () => {
    const id = await venueBooking(await fixtures.event("planning", rachel.userId), await fixtures.venue(), at("2031-03-05", "09:00", "12:00"), { status: "rejected" });

    expect(await rachel.repo.change(id, change(at("2031-03-05", "13:00", "15:00")), new Date())).toBeNull();
    expect((await row("venue_bookings", id)).status).toBe("rejected");
  });

  // ----------------------------------------------------------------------------
  // AC2: cancel one venue booking
  // ----------------------------------------------------------------------------

  it("102-S12, S14: cancelling records who, when and why, and frees the venue for that period", async () => {
    const event = await fixtures.event("planning", rachel.userId);
    const venue = await fixtures.venue();
    const id = await venueBooking(event, venue, at("2031-03-06", "09:00", "12:00"), { status: "approved" });

    const cancelled = await rachel.repo.cancel(id, rachel.userId, new Date(), "Moved to a bigger room");

    expect(cancelled).toMatchObject({ status: "cancelled", cancelledBy: rachel.userId, cancellationReason: "Moved to a bigger room" });
    expect(cancelled?.cancelledAt).toBeInstanceOf(Date);
    await venueBooking(await fixtures.event("planning", rachel.userId), venue, at("2031-03-06", "09:00", "12:00")); // free again
  });

  it("102-S11: a withdrawn venue booking is not cancelled", async () => {
    const id = await venueBooking(await fixtures.event("planning", rachel.userId), await fixtures.venue(), at("2031-03-07", "09:00", "12:00"), { status: "withdrawn" });

    expect(await rachel.repo.cancel(id, rachel.userId, new Date(), "x")).toBeNull();
    expect((await row("venue_bookings", id)).status).toBe("withdrawn");
  });

  // ----------------------------------------------------------------------------
  // AC6: the functions check the caller and the event themselves, so calling them directly cannot get round the service
  // ----------------------------------------------------------------------------

  it("102-S21: another coordinator calling the functions directly is refused, and nothing changes", async () => {
    const id = await venueBooking(await fixtures.event("planning", rachel.userId), await fixtures.venue(), at("2031-03-08", "09:00", "12:00"));

    await expect(marcus.repo.change(id, change(at("2031-03-08", "13:00", "15:00")), new Date())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(marcus.repo.cancel(id, marcus.userId, new Date(), "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await row("venue_bookings", id)).toMatchObject({ status: "requested", cancelled_by: null });
  });

  it("102-S23: a Confirmed event's venue booking is refused with EVENT_NOT_ELIGIBLE", async () => {
    const id = await venueBooking(await fixtures.event("confirmed", rachel.userId), await fixtures.venue(), at("2031-03-09", "09:00", "12:00"));

    await expect(rachel.repo.cancel(id, rachel.userId, new Date(), "x")).rejects.toMatchObject({ code: "EVENT_NOT_ELIGIBLE" });
    await expect(rachel.repo.change(id, change(at("2031-03-09", "13:00", "15:00")), new Date())).rejects.toMatchObject({ code: "EVENT_NOT_ELIGIBLE" });
  });

  // ----------------------------------------------------------------------------
  // AC7: cancelling releases the venue booking's equipment; AC8: changing its time moves the equipment and re-submits it
  // ----------------------------------------------------------------------------

  it("102-S28: cancelling releases the venue booking's Arranged and Submitted equipment requests, and nothing else", async () => {
    const event = await fixtures.event("planning", rachel.userId);
    const period = at("2031-03-10", "09:00", "12:00");
    const id = await venueBooking(event, await fixtures.venue(), period, { status: "approved" });
    const otherVenueBooking = await venueBooking(event, await fixtures.venue(), period, { status: "approved" });
    const arranged = await equipmentRequest(event, id, period, "approved");
    const submitted = await equipmentRequest(event, id, period, "requested");
    const otherVenues = await equipmentRequest(event, otherVenueBooking, period, "approved");
    const unlinked = await equipmentRequest(event, null, period, "requested");

    await rachel.repo.cancel(id, rachel.userId, new Date(), "Moved to a bigger room");

    expect((await row("equipment_reservations", arranged)).status).toBe("cancelled");
    expect((await row("equipment_reservations", submitted)).status).toBe("cancelled");
    expect((await row("equipment_reservations", otherVenues)).status).toBe("approved");
    expect((await row("equipment_reservations", unlinked)).status).toBe("requested");
  });

  it("102-S32: a refused cancel leaves the equipment as it was", async () => {
    const event = await fixtures.event("planning", rachel.userId);
    const period = at("2031-03-11", "09:00", "12:00");
    const id = await venueBooking(event, await fixtures.venue(), period, { status: "approved" });
    const arranged = await equipmentRequest(event, id, period, "approved");

    await expect(marcus.repo.cancel(id, marcus.userId, new Date(), "x")).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect((await row("equipment_reservations", arranged)).status).toBe("approved");
  });

  it("102-S33: changing the time moves the venue booking's equipment to the new time and sends it back to Submitted", async () => {
    const event = await fixtures.event("planning", rachel.userId);
    const period = at("2031-03-12", "09:00", "12:00");
    const id = await venueBooking(event, await fixtures.venue(), period, { status: "approved" });
    const arranged = await equipmentRequest(event, id, period, "approved");

    await rachel.repo.change(id, change(at("2031-03-12", "14:00", "17:00")), new Date());

    const moved = await row("equipment_reservations", arranged);
    expect(moved).toMatchObject({ status: "requested", quantity_reserved: null });
    expect(new Date(moved.start_datetime as string)).toEqual(sgtToUtc("2031-03-12", "14:00"));
    expect(new Date(moved.end_datetime as string)).toEqual(sgtToUtc("2031-03-12", "17:00"));
  });

  it("102-S34: changing only the attendance leaves the equipment as it was", async () => {
    const event = await fixtures.event("planning", rachel.userId);
    const period = at("2031-03-13", "09:00", "12:00");
    const id = await venueBooking(event, await fixtures.venue(), period, { status: "approved" });
    const arranged = await equipmentRequest(event, id, period, "approved");

    await rachel.repo.change(id, change(period, { expectedAttendance: 90 }), new Date());

    expect(await row("equipment_reservations", arranged)).toMatchObject({ status: "approved", quantity_reserved: 2 });
  });
});
// end of SCRUM-102 against Postgres
