import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { SupabaseEventReader } from "../../src/readers/supabaseEventReader";
import { SupabaseVenueReader } from "../../src/readers/venueReader";
import { SupabaseVenueDetailsReader } from "../../src/readers/venueDetailsReader";
import { BookingService } from "../../src/services/bookingService";
import { DecisionService } from "../../src/services/decisionService";
import { TrackingService } from "../../src/services/trackingService";
import { adminClient, Fixtures, hasDb, signInAs } from "./support/db";

const STAFF_EMAIL = "kenneth.wong@connectsphere.example.com";
const NOW = new Date("2026-10-05T00:00:00Z");
const period = (date: string, start: string, end: string) => ({ start: sgtToUtc(date, start), end: sgtToUtc(date, end) });
const snapshot = { eventName: "IT", expectedAttendance: 50, venueRequirements: null, accessibilityNeeds: null };

/** SCRUM-38 decisions against real Postgres, signed in as seeded Venue Staff so RLS applies. */
describe.skipIf(!hasDb)("SCRUM-38 booking decisions against Postgres", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const adminRepo = new SupabaseBookingRepository(admin);
  let staffId: string;
  let staffClient: Awaited<ReturnType<typeof signInAs>>["client"];
  let decisions: DecisionService;
  let coordinator: string;

  const create = (eventId: string, venueId: string, p: { start: Date; end: Date }) =>
    adminRepo.insert({ eventId, venueId, ...p, requestedBy: coordinator, snapshot });
  const staff = () => ({ id: staffId, role: "venue_staff" as const });

  beforeAll(async () => {
    const { data, error } = await admin.from("users").select("id").eq("role", "event_coordinator").limit(1).single();
    if (error) throw new Error(error.message);
    coordinator = data.id as string;

    const { client, userId } = await signInAs(STAFF_EMAIL);
    staffId = userId;
    staffClient = client;
    decisions = new DecisionService({
      bookings: new SupabaseBookingRepository(client),
      events: new SupabaseEventReader(client),
      venues: new SupabaseVenueReader(client),
      now: () => NOW,
    });
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("38-S3 two approvals in parallel: exactly one wins, repeated", async () => {
    for (let i = 0; i < 10; i++) {
      const booking = await create(await fixtures.event(), await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));
      const results = await Promise.allSettled([decisions.approve(staff(), booking.id), decisions.approve(staff(), booking.id)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(lost.reason).toMatchObject({ code: "NOT_PENDING", httpStatus: 409 });
    }
  }, 60_000);

  it("38-S5 after approval an overlapping request for the same venue is SLOT_CONFLICT", async () => {
    const venue = await fixtures.venue();
    const first = await create(await fixtures.event("approved", coordinator), venue, period("2030-11-14", "09:00", "17:00"));
    await decisions.approve(staff(), first.id);

    const otherEvent = await fixtures.event("approved", coordinator);
    // SCRUM-103: the padded availability check answers coordinators and venue staff only, so use a signed-in client (as the
    // service does in production). The overlap is refused by the pre-check, before any insert, so staff RLS is not in play.
    const service = new BookingService({
      bookings: new SupabaseBookingRepository(staffClient),
      events: new SupabaseEventReader(admin),
      venues: new SupabaseVenueReader(admin),
      venueDetails: new SupabaseVenueDetailsReader(admin),
      now: () => NOW,
    });
    await expect(
      service.submit(
        { id: coordinator, role: "event_coordinator" },
        { eventId: otherEvent, venueId: venue, date: "2030-11-14", startTime: "10:00", endTime: "12:00" },
      ),
    ).rejects.toMatchObject({ code: "SLOT_CONFLICT", httpStatus: 409 });
  });

  it("38-S6 the Coordinator's list shows APPROVED with its decision date", async () => {
    const eventId = await fixtures.event("approved", coordinator);
    const booking = await create(eventId, await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));
    const decided = await decisions.approve(staff(), booking.id);
    expect(decided).toMatchObject({ status: "approved", reviewedBy: staffId });

    const tracking = new TrackingService({
      bookings: adminRepo,
      events: new SupabaseEventReader(admin),
      venues: new SupabaseVenueReader(admin),
    });
    const row = (await tracking.list({ id: coordinator, role: "event_coordinator" })).find((b) => b.id === booking.id);
    expect(row).toMatchObject({ status: "APPROVED", decidedAt: decided.reviewedAt!.toISOString() });
  });

  it("38-S1 an approved request leaves the pending queue", async () => {
    const booking = await create(await fixtures.event(), await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));
    await decisions.approve(staff(), booking.id);
    expect((await adminRepo.listPending()).map((b) => b.id)).not.toContain(booking.id);
  });
});

/** SCRUM-39 rejections against real Postgres, signed in as seeded Venue Staff so RLS applies. */
describe.skipIf(!hasDb)("SCRUM-39 booking rejections against Postgres", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const adminRepo = new SupabaseBookingRepository(admin);
  let staffId: string;
  let decisions: DecisionService;
  let coordinator: string;

  const create = (eventId: string, venueId: string, p: { start: Date; end: Date }) =>
    adminRepo.insert({ eventId, venueId, ...p, requestedBy: coordinator, snapshot });
  const staff = () => ({ id: staffId, role: "venue_staff" as const });

  beforeAll(async () => {
    const { data, error } = await admin.from("users").select("id").eq("role", "event_coordinator").limit(1).single();
    if (error) throw new Error(error.message);
    coordinator = data.id as string;

    const { client, userId } = await signInAs(STAFF_EMAIL);
    staffId = userId;
    decisions = new DecisionService({
      bookings: new SupabaseBookingRepository(client),
      events: new SupabaseEventReader(client),
      venues: new SupabaseVenueReader(client),
      now: () => NOW,
    });
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("39-S1 the reason, decider and time are stored, and the request leaves the pending queue", async () => {
    const booking = await create(await fixtures.event(), await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));
    const rejected = await decisions.reject(staff(), booking.id, { reason: "  Room under renovation  " });
    expect(rejected).toMatchObject({ status: "rejected", reviewNotes: "Room under renovation", reviewedBy: staffId });
    expect(rejected.reviewedAt?.getTime()).toBe(NOW.getTime());
    expect((await adminRepo.listPending()).map((b) => b.id)).not.toContain(booking.id);
  });

  it("39-S4 the slot is released: another event can then request the same venue and period", async () => {
    const venue = await fixtures.venue();
    const p = period("2030-11-14", "09:00", "17:00");
    const first = await create(await fixtures.event(), venue, p);
    await expect(create(await fixtures.event(), venue, p)).rejects.toMatchObject({ code: "SLOT_CONFLICT" });

    await decisions.reject(staff(), first.id, { reason: "Not available" });
    expect(await create(await fixtures.event(), venue, p)).toMatchObject({ status: "requested" });
  });

  it("39-S5 two rejections (and a reject with an approve) in parallel: exactly one wins, repeated", async () => {
    for (let i = 0; i < 10; i++) {
      const booking = await create(await fixtures.event(), await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));
      const second =
        i % 2 === 0 ? decisions.reject(staff(), booking.id, { reason: "Two" }) : decisions.approve(staff(), booking.id);
      const results = await Promise.allSettled([decisions.reject(staff(), booking.id, { reason: "One" }), second]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(lost.reason).toMatchObject({ code: "NOT_PENDING", httpStatus: 409 });
    }
  }, 60_000);

  it("39-S2 an invalid reason changes nothing", async () => {
    const booking = await create(await fixtures.event(), await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));
    await expect(decisions.reject(staff(), booking.id, { reason: "   " })).rejects.toMatchObject({ httpStatus: 422 });
    expect((await adminRepo.getById(booking.id))?.status).toBe("requested");
  });
});
