import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { SupabaseEventReader } from "../../src/readers/supabaseEventReader";
import { SupabaseVenueReader } from "../../src/readers/venueReader";
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
    const service = new BookingService({
      bookings: adminRepo,
      events: new SupabaseEventReader(admin),
      venues: new SupabaseVenueReader(admin),
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
