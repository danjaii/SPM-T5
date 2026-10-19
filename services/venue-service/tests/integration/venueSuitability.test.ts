import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { SupabaseEventReader } from "../../src/readers/supabaseEventReader";
import { SupabaseVenueDetailsReader } from "../../src/readers/venueDetailsReader";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { availabilityLookup } from "../../src/services/availabilityLookup";
import { SuitabilityService } from "../../src/services/suitabilityService";
import { adminClient, DB_ENV, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-109 against real Postgres, as seeded users so RLS applies: the venue's layouts and hours are read through the
 * catalogue policies, availability sees another coordinator's booking (migration 14), and venue staff can check an
 * event only once it has a booking (events RLS, migration 14). Fixtures are prefixed "IT-" and cleaned up.
 */
const COORDINATOR = "rachel.tan@connectsphere.example.com";
const OTHER_COORDINATOR = "marcus.lim@connectsphere.example.com";
const STAFF = "kenneth.wong@connectsphere.example.com";

describe.skipIf(!hasDb)("SCRUM-109 venue suitability against Postgres", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  let coordinator: { userId: string; service: SuitabilityService };
  let staff: { userId: string; service: SuitabilityService };

  const serviceFor = (client: Awaited<ReturnType<typeof signInAs>>["client"]) =>
    new SuitabilityService({
      events: new SupabaseEventReader(client),
      venueDetails: new SupabaseVenueDetailsReader(client),
      availability: availabilityLookup(new SupabaseBookingRepository(client)),
    });

  /** An event of the coordinator on 2031-05-<day>, 09:00-12:00 SGT, for 120 attendees. */
  async function anEvent(day: string) {
    const id = await fixtures.event("approved", coordinator.userId);
    const { error } = await admin
      .from("events")
      .update({
        expected_attendance: 120,
        preferred_start_datetime: sgtToUtc(`2031-05-${day}`, "09:00").toISOString(),
        preferred_end_datetime: sgtToUtc(`2031-05-${day}`, "12:00").toISOString(),
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
    return id;
  }

  async function book(eventId: string, venueId: string, requestedBy: string, day: string) {
    const { error } = await admin.from("venue_bookings").insert({
      event_id: eventId,
      venue_id: venueId,
      requested_by: requestedBy,
      status: "requested",
      event_start_datetime: sgtToUtc(`2031-05-${day}`, "08:00").toISOString(),
      event_end_datetime: sgtToUtc(`2031-05-${day}`, "18:00").toISOString(),
    });
    if (error) throw new Error(error.message);
  }

  beforeAll(async () => {
    if (!DB_ENV.publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY must be set for the RLS tests (see README).");
    const c = await signInAs(COORDINATOR);
    coordinator = { userId: c.userId, service: serviceFor(c.client) };
    const s = await signInAs(STAFF);
    staff = { userId: s.userId, service: serviceFor(s.client) };
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  const criterion = (r: Awaited<ReturnType<SuitabilityService["check"]>>, key: string) => r.criteria.find((c) => c.key === key)!;

  it("109-S1/S2 a coordinator reads the venue's capacity and hours: a 60-seat venue is too small for 120", async () => {
    const event = await anEvent("10");
    const venue = await fixtures.venue("IT-lotus", { max_capacity: 60, operating_hours_start: "08:00", operating_hours_end: "22:00" });
    const report = await coordinator.service.check({ id: coordinator.userId, role: "event_coordinator" }, { venueId: venue, eventId: event });
    expect(report.overall).toBe("not_suitable");
    expect(criterion(report, "capacity")).toMatchObject({ status: "not_met", message: "Expected attendance 120 exceeds capacity 60" });
    expect(criterion(report, "operatingHours").status).toBe("met");
    expect(criterion(report, "availability").status).toBe("met");
  });

  it("109-S4 another coordinator's booking makes the venue unavailable, though RLS hides it from the caller", async () => {
    const event = await anEvent("11");
    const venue = await fixtures.venue("IT-orchid", { max_capacity: 200 });
    const other = await signInAs(OTHER_COORDINATOR);
    await book(await fixtures.event("approved", other.userId), venue, other.userId, "11");

    const report = await coordinator.service.check({ id: coordinator.userId, role: "event_coordinator" }, { venueId: venue, eventId: event });
    expect(criterion(report, "availability").status).toBe("not_met");
    expect(report.overall).toBe("not_suitable");
  });

  it("109-S5 operating hours: a venue that opens at 10:00 is not open for a 09:00 start", async () => {
    const event = await anEvent("12");
    const venue = await fixtures.venue("IT-late", { max_capacity: 200, operating_hours_start: "10:00", operating_hours_end: "22:00" });
    const report = await coordinator.service.check({ id: coordinator.userId, role: "event_coordinator" }, { venueId: venue, eventId: event });
    expect(criterion(report, "operatingHours").status).toBe("not_met");
  });

  it("109-S7 venue staff can check an event that has a booking, and cannot see one that has none (404)", async () => {
    const event = await anEvent("13");
    const venue = await fixtures.venue("IT-staff", { max_capacity: 200 });
    const caller = { id: staff.userId, role: "venue_staff" as const };

    await expect(staff.service.check(caller, { venueId: venue, eventId: event })).rejects.toMatchObject({ httpStatus: 404 });

    await book(event, venue, coordinator.userId, "13");
    const report = await staff.service.check(caller, { venueId: venue, eventId: event });
    expect(report.event.id).toBe(event);
  });
});
