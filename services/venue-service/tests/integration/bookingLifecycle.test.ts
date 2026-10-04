import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { TrackingService } from "../../src/services/trackingService";
import { SupabaseEventReader } from "../../src/readers/supabaseEventReader";
import { SupabaseVenueReader } from "../../src/readers/venueReader";
import { adminClient, Fixtures, hasDb } from "./support/db";

const period = (date: string, start: string, end: string) => ({ start: sgtToUtc(date, start), end: sgtToUtc(date, end) });
const snapshot = { eventName: "IT", expectedAttendance: 50, venueRequirements: null, accessibilityNeeds: null };

describe.skipIf(!hasDb)("SCRUM-35 / SCRUM-32 / SCRUM-33 booking lifecycle against Postgres", () => {
  const db = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(db);
  const repo = new SupabaseBookingRepository(db);
  let coordinator: string;
  let staff: string;

  const create = (eventId: string, venueId: string, p: { start: Date; end: Date }) =>
    repo.insert({ eventId, venueId, ...p, requestedBy: coordinator, snapshot });

  beforeAll(async () => {
    const user = async (role: string) => {
      const { data, error } = await db.from("users").select("id").eq("role", role).limit(1).single();
      if (error) throw new Error(`Need a seeded ${role} (run supabase db reset): ${error.message}`);
      return data.id as string;
    };
    coordinator = await user("event_coordinator");
    staff = await user("venue_staff");
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("32-S1 a new request is PENDING with the snapshot and submitter, and appears in the pending queue", async () => {
    const booking = await create(await fixtures.event(), await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));
    expect(booking).toMatchObject({ status: "requested", requestedBy: coordinator });
    expect(booking.snapshot).toMatchObject({ eventName: "IT", expectedAttendance: 50 });
    expect((await repo.listPending()).map((b) => b.id)).toContain(booking.id);
  });

  it("35-S1 withdrawing records who and when, and takes it out of the pending queue", async () => {
    const booking = await create(await fixtures.event(), await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));
    const at = new Date();
    const withdrawn = await repo.withdraw(booking.id, coordinator, at);
    expect(withdrawn).toMatchObject({ status: "withdrawn", withdrawnBy: coordinator });
    expect(withdrawn?.withdrawnAt?.getTime()).toBe(at.getTime());
    expect((await repo.listPending()).map((b) => b.id)).not.toContain(booking.id);
    expect(await repo.withdraw(booking.id, coordinator, at)).toBeNull();
  });

  it("35-S4 the slot is released: another event can request it, and the same event can request again", async () => {
    const venue = await fixtures.venue();
    const eventA = await fixtures.event();
    const p = period("2030-11-14", "09:00", "17:00");
    const first = await create(eventA, venue, p);
    await repo.withdraw(first.id, coordinator, new Date());

    expect(await repo.hasHold(venue, p.start, p.end)).toBe(false);
    expect(await create(await fixtures.event(), venue, p)).toMatchObject({ status: "requested" });

    const eventC = await fixtures.event();
    const second = await create(eventC, await fixtures.venue(), p);
    await repo.withdraw(second.id, coordinator, new Date());
    expect(await create(eventC, await fixtures.venue(), p)).toMatchObject({ status: "requested" });
  });

  it.each(["approved", "rejected"] as const)(
    "35-S5 withdraw and %s in parallel: exactly one succeeds, the other is refused (repeated)",
    async (outcome) => {
      for (let i = 0; i < 20; i++) {
        const booking = await create(await fixtures.event(), await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));
        const results = await Promise.all([
          repo.withdraw(booking.id, coordinator, new Date()),
          repo.decide(booking.id, { outcome }, staff, new Date()),
        ]);
        expect(results.filter((r) => r !== null)).toHaveLength(1);
        const { data } = await db.from("venue_bookings").select("status").eq("id", booking.id).single();
        expect(data?.status).toBe(results[0] ? "withdrawn" : outcome);
      }
    },
    60_000,
  );

  it("33-S6 after a decision through decide(), the Coordinator's list shows APPROVED with its decision date", async () => {
    const eventId = await fixtures.event("approved", coordinator);
    const booking = await create(eventId, await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));
    const tracking = new TrackingService({
      bookings: repo,
      events: new SupabaseEventReader(db),
      venues: new SupabaseVenueReader(db),
    });
    const caller = { id: coordinator, role: "event_coordinator" as const };

    const before = (await tracking.list(caller)).find((b) => b.id === booking.id);
    expect(before).toMatchObject({ status: "PENDING", decidedAt: null });

    const decidedAt = new Date();
    await repo.decide(booking.id, { outcome: "approved" }, staff, decidedAt);
    const after = (await tracking.list(caller)).find((b) => b.id === booking.id);
    expect(after).toMatchObject({ status: "APPROVED", decidedAt: decidedAt.toISOString() });
  });

  it("decision seam (SCRUM-37 to 40): a rejection stores its reason and suggestion, and only one of two racing decisions wins", async () => {
    const venue = await fixtures.venue();
    const other = await fixtures.venue();
    const booking = await create(await fixtures.event(), venue, period("2030-11-14", "09:00", "17:00"));
    const suggestion = { venueId: other, ...period("2030-11-15", "09:00", "17:00") };
    const [a, b] = await Promise.all([
      repo.decide(booking.id, { outcome: "rejected", reason: "Renovation", suggestion }, staff, new Date()),
      repo.decide(booking.id, { outcome: "approved" }, staff, new Date()),
    ]);
    expect([a, b].filter((r) => r !== null)).toHaveLength(1);
    const stored = await repo.getById(booking.id);
    if (stored?.status === "rejected") {
      expect(stored).toMatchObject({ reviewNotes: "Renovation", suggestion: { venueId: other } });
    }
  });
});
