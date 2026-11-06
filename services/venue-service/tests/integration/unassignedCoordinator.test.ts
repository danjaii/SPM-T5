import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseEventReader } from "../../src/readers/supabaseEventReader";
import { SupabaseVenueDetailsReader } from "../../src/readers/venueDetailsReader";
import { SupabaseVenueReader } from "../../src/readers/venueReader";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { BookingService } from "../../src/services/bookingService";
import { TrackingService } from "../../src/services/trackingService";
import { adminClient, DB_ENV, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-98/AC6 (98-S26, 98-S27) against real Postgres: a coordinator the event is not assigned to cannot request a venue for
 * it or list its bookings, and gets 404. Since SCRUM-156 (migration 59) Row-Level Security hides another coordinator's event,
 * so venue-service, reading it with the caller's own token, does not find it (spec 98, Implementation decisions; E2E defect
 * D-002). The unit tests cannot show this: their fakes have no Row-Level Security. Fixtures are prefixed "IT-" and cleaned up.
 */
const ASSIGNED = "rachel.tan@connectsphere.example.com";
const OTHER = "marcus.lim@connectsphere.example.com";
const NOW = new Date("2026-10-14T00:00:00.000Z");

type SignedIn = Awaited<ReturnType<typeof signInAs>>;

describe.skipIf(!hasDb)("SCRUM-98/AC6, SCRUM-199/AC1 an unassigned coordinator against Postgres (migration 59)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  let assigned: SignedIn;
  let other: SignedIn;

  function servicesFor(user: SignedIn) {
    const ports = {
      bookings: new SupabaseBookingRepository(user.client),
      events: new SupabaseEventReader(user.client),
      venues: new SupabaseVenueReader(user.client),
      venueDetails: new SupabaseVenueDetailsReader(user.client),
      now: () => NOW,
    };
    return { booking: new BookingService(ports), tracking: new TrackingService(ports), caller: { id: user.userId, role: "event_coordinator" as const } };
  }

  const request = (eventId: string, venueId: string) => ({ eventId, venueId, date: "2031-06-12", startTime: "10:00", endTime: "12:00" });

  async function bookingCount(eventId: string) {
    const { count, error } = await admin.from("venue_bookings").select("id", { count: "exact", head: true }).eq("event_id", eventId);
    if (error) throw new Error(error.message);
    return count;
  }

  beforeAll(async () => {
    if (!DB_ENV.publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY must be set for the RLS tests (see README).");
    [assigned, other] = await Promise.all([signInAs(ASSIGNED), signInAs(OTHER)]);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("98-S26 a coordinator the event is not assigned to requests a venue: 404 and no booking", async () => {
    const event = await fixtures.event("approved", assigned.userId);
    const venue = await fixtures.venue("IT-unassigned-request");
    const { booking, caller } = servicesFor(other);

    await expect(booking.submit(caller, request(event, venue))).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });
    expect(await bookingCount(event)).toBe(0);
  });

  it("98-S27 the same coordinator reads the event's bookings list: 404", async () => {
    const event = await fixtures.event("approved", assigned.userId);
    const { tracking, caller } = servicesFor(other);

    await expect(tracking.forEvent(caller, event)).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });
  });

  it("98-S26, 98-S27 positive control: the assigned coordinator lists the event's bookings and can request a venue", async () => {
    const event = await fixtures.event("approved", assigned.userId);
    const venue = await fixtures.venue("IT-assigned-request");
    const { booking, tracking, caller } = servicesFor(assigned);

    await expect(tracking.forEvent(caller, event)).resolves.toEqual([]);
    await booking.submit(caller, request(event, venue));
    expect(await bookingCount(event)).toBe(1);
  });
});
