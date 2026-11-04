import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { SupabaseEventReader } from "../../src/readers/supabaseEventReader";
import { SupabaseVenueReader } from "../../src/readers/venueReader";
import { DecisionService } from "../../src/services/decisionService";
import { adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-40 (docs/specs/venue-booking-suggestion.md) against real Postgres, signed in as seeded Venue Staff so row level security
 * applies: the suggestion is stored with the rejection through the same conditional update as SCRUM-39, it holds no slot, and a
 * malformed or inactive venue is refused. Fixtures are made with the secret key, named "IT-", dated 2030 and removed afterwards.
 */
const STAFF_EMAIL = "kenneth.wong@connectsphere.example.com";
const COORDINATOR_EMAIL = "rachel.tan@connectsphere.example.com";
const NOW = new Date("2026-10-05T00:00:00Z");
const REASON = "Room under renovation";
const period = (date: string, start: string, end: string) => ({ start: sgtToUtc(date, start), end: sgtToUtc(date, end) });
const snapshot = { eventName: "IT", expectedAttendance: 50, venueRequirements: null, accessibilityNeeds: null };
const NIL_ID = "00000000-0000-0000-0000-000000000000";

describe.skipIf(!hasDb)("SCRUM-40 suggest an alternative arrangement against Postgres", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const adminRepo = new SupabaseBookingRepository(admin);
  let staffId: string;
  let decisions: DecisionService;
  let coordinator: string;
  let coordinatorClient: Awaited<ReturnType<typeof signInAs>>["client"];

  const create = (eventId: string, venueId: string, p: { start: Date; end: Date }) =>
    adminRepo.insert({ eventId, venueId, ...p, requestedBy: coordinator, snapshot });
  const staff = () => ({ id: staffId, role: "venue_staff" as const });
  const stored = async (id: string) =>
    (await admin.from("venue_bookings").select("status, review_notes, suggested_venue_id, suggested_start_datetime, suggested_end_datetime").eq("id", id).single()).data;
  const lotus = (venueId: string, over: Record<string, string> = {}) => ({ venueId, date: "2030-11-15", startTime: "09:00", endTime: "17:00", ...over });

  beforeAll(async () => {
    const signedCoordinator = await signInAs(COORDINATOR_EMAIL);
    coordinator = signedCoordinator.userId;
    coordinatorClient = signedCoordinator.client;

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

  describe("SCRUM-40/AC1 the suggestion is stored with the rejection (40-S1)", () => {
    it("40-S1: the rejected request keeps its reason and the suggested venue and period, and the answer carries them", async () => {
      const venue = await fixtures.venue();
      const other = await fixtures.venue();
      const booking = await create(await fixtures.event(), venue, period("2030-11-14", "09:00", "17:00"));

      const answer = await decisions.reject(staff(), booking.id, { reason: REASON, suggestion: lotus(other) });

      expect(answer).toMatchObject({ id: booking.id, status: "rejected", reviewNotes: REASON, suggestion: { venueId: other } });
      expect(await stored(booking.id)).toEqual({
        status: "rejected",
        review_notes: REASON,
        suggested_venue_id: other,
        suggested_start_datetime: sgtToUtc("2030-11-15", "09:00").toISOString().replace(/\.000Z$/, "+00:00"),
        suggested_end_datetime: sgtToUtc("2030-11-15", "17:00").toISOString().replace(/\.000Z$/, "+00:00"),
      });
    });
  });

  describe("SCRUM-40/AC2 the suggestion is optional (40-S2)", () => {
    it("40-S2: a rejection with no suggestion stores none", async () => {
      const booking = await create(await fixtures.event(), await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));

      await decisions.reject(staff(), booking.id, { reason: REASON });

      expect(await stored(booking.id)).toMatchObject({ status: "rejected", suggested_venue_id: null, suggested_start_datetime: null, suggested_end_datetime: null });
    });
  });

  describe("SCRUM-40/AC3 a suggestion does not hold the slot (40-S3)", () => {
    it("40-S3: a different coordinator's request for the suggested venue and period is accepted by the database, still pending", async () => {
      const venue = await fixtures.venue();
      const other = await fixtures.venue();
      const booking = await create(await fixtures.event(), venue, period("2030-11-14", "09:00", "17:00"));
      await decisions.reject(staff(), booking.id, { reason: REASON, suggestion: lotus(other) });

      const theirs = await create(await fixtures.event("approved", coordinator), other, period("2030-11-15", "09:00", "17:00"));

      expect(theirs.status).toBe("requested");
      expect((await stored(booking.id))?.suggested_venue_id).toBe(other);
    });

    it("40-S3: and even once that request is approved, the suggestion is still stored, not honoured", async () => {
      const venue = await fixtures.venue();
      const other = await fixtures.venue();
      const booking = await create(await fixtures.event(), venue, period("2030-11-14", "09:00", "17:00"));
      await decisions.reject(staff(), booking.id, { reason: REASON, suggestion: lotus(other) });
      const theirs = await create(await fixtures.event("approved", coordinator), other, period("2030-11-15", "09:00", "17:00"));

      const approved = await decisions.approve(staff(), theirs.id);

      expect(approved.status).toBe("approved");
      expect((await stored(booking.id))?.suggested_venue_id).toBe(other);
    });
  });

  describe("SCRUM-40/AC1 a suggestion the database cannot honour is refused (40-S4)", () => {
    it.each([
      ["a venue id that does not exist", NIL_ID],
      ["a venue id that is not even a uuid", "not-a-uuid"],
    ])("40-S4: %s is a 422 on the venue field and nothing is rejected", async (_label, venueId) => {
      const booking = await create(await fixtures.event(), await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));

      await expect(decisions.reject(staff(), booking.id, { reason: REASON, suggestion: lotus(venueId) })).rejects.toMatchObject({
        httpStatus: 422,
        fieldErrors: { "suggestion.venueId": "Choose a venue from the list." },
      });

      expect(await stored(booking.id)).toMatchObject({ status: "requested", suggested_venue_id: null });
    });

    it("40-S4: an inactive venue is refused, and an active one is accepted", async () => {
      const booking = await create(await fixtures.event(), await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));
      const closed = await fixtures.venue("IT-40-closed", { is_active: false });
      const open = await fixtures.venue("IT-40-open");

      await expect(decisions.reject(staff(), booking.id, { reason: REASON, suggestion: lotus(closed) })).rejects.toMatchObject({ httpStatus: 422 });
      expect((await stored(booking.id))?.status).toBe("requested");

      await decisions.reject(staff(), booking.id, { reason: REASON, suggestion: lotus(open) });
      expect(await stored(booking.id)).toMatchObject({ status: "rejected", suggested_venue_id: open });
    });
  });

  describe("SCRUM-40/AC1,AC2 only Venue Staff, and only once (40-S5)", () => {
    it("40-S5: a coordinator's own write of a rejection with a suggestion changes nothing (row level security)", async () => {
      const other = await fixtures.venue();
      const booking = await create(await fixtures.event("approved", coordinator), await fixtures.venue(), period("2030-11-14", "09:00", "17:00"));
      const asCoordinator = new SupabaseBookingRepository(coordinatorClient);

      const outcome = await asCoordinator
        .decide(booking.id, { outcome: "rejected", reason: REASON, suggestion: { venueId: other, ...period("2030-11-15", "09:00", "17:00") } }, coordinator, NOW)
        .catch(() => null);

      expect(outcome).toBeNull();
      expect(await stored(booking.id)).toMatchObject({ status: "requested", suggested_venue_id: null });
    });

    it("40-S5: two rejections racing with different suggestions: exactly one wins and its suggestion is the one stored", async () => {
      const venue = await fixtures.venue();
      const first = await fixtures.venue();
      const second = await fixtures.venue();
      const booking = await create(await fixtures.event(), venue, period("2030-11-14", "09:00", "17:00"));

      const results = await Promise.allSettled([
        decisions.reject(staff(), booking.id, { reason: "First", suggestion: lotus(first) }),
        decisions.reject(staff(), booking.id, { reason: "Second", suggestion: lotus(second) }),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(lost.reason).toMatchObject({ code: "NOT_PENDING", httpStatus: 409 });
      const row = await stored(booking.id);
      expect(row?.review_notes === "First" ? first : second).toBe(row?.suggested_venue_id);
    });
  });
});
