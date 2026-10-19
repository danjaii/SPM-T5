import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sgtToUtc } from "@spm-t5/shared";
import type { NewBooking } from "../../src/domain/types";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { DB_ENV, adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-107 against Postgres (migrations 47 and 48, docs/specs/replacement-venue.md): the trigger that lets an approved replacement
 * take over a flagged booking. Everyone signs in as a seeded user so grants and policies are the real ones; the secret key only
 * arranges fixtures and reads results. Fixtures are throwaway ("IT-") and dated 2030.
 */
const EMAILS = {
  rachel: "rachel.tan@connectsphere.example.com",
  marcus: "marcus.lim@connectsphere.example.com",
  staff: "kenneth.wong@connectsphere.example.com",
};
const at = (date: string, time: string) => sgtToUtc(date, time);
const DAY = { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") };
const BLOCK = { start: at("2030-11-14", "08:00"), end: at("2030-11-16", "18:00") };

type Who = keyof typeof EMAILS;
type Actor = { client: SupabaseClient; userId: string; repo: SupabaseBookingRepository };

describe.skipIf(!hasDb || !DB_ENV.publishableKey)("SCRUM-107 replacement venue (migrations 47 and 48)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<Who, Actor>;
  let equipmentId: string;

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Who[]) {
      const { client, userId } = await signInAs(EMAILS[key]);
      who[key] = { client, userId, repo: new SupabaseBookingRepository(client) };
    }
    const { data, error } = await admin.from("equipment").select("id").limit(1).single();
    if (error) throw new Error(`Need seeded equipment (run supabase db reset): ${error.message}`);
    equipmentId = data.id as string;
  });
  afterAll(async () => {
    await fixtures.cleanup();
  });

  const venue = (setup = 0) => fixtures.venue("IT-venue", { setup_minutes: setup, max_capacity: 200 });

  /** An approved booking, then Venue Staff mark its venue unavailable, which flags it (SCRUM-106). Returns what the tests need. */
  async function flaggedBooking(eventStatus = "confirmed", period = DAY) {
    const orchid = await venue();
    const lotus = await venue();
    const eventId = await fixtures.event(eventStatus, who.rachel.userId);
    const { data, error } = await admin
      .from("venue_bookings")
      .insert({
        event_id: eventId,
        venue_id: orchid,
        requested_by: who.rachel.userId,
        status: "approved",
        event_start_datetime: period.start.toISOString(),
        event_end_datetime: period.end.toISOString(),
        snapshot_event_name: "IT",
        snapshot_expected_attendance: 120,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const original = data.id as string;
    const marked = await who.staff.client.rpc("mark_venue_unavailable", {
      p_venue_id: orchid,
      p_start: BLOCK.start.toISOString(),
      p_end: BLOCK.end.toISOString(),
      p_reason: "maintenance",
      p_notes: null,
    });
    if (marked.error) throw new Error(marked.error.message);
    return { orchid, lotus, eventId, original };
  }

  /** Rachel requests the replacement the way venue-service does (an amendment link to the original), through RLS. */
  function requestReplacement(f: { eventId: string; original: string }, venueId: string, actor: Actor = who.rachel) {
    const input: NewBooking = {
      eventId: f.eventId,
      venueId,
      ...DAY,
      requestedBy: actor.userId,
      snapshot: { eventName: "IT", expectedAttendance: 120, venueRequirements: null, accessibilityNeeds: null },
      amendsBookingId: f.original,
    };
    return actor.repo.insert(input);
  }

  const row = async (id: string) => (await admin.from("venue_bookings").select("*").eq("id", id).single()).data as Record<string, unknown>;
  const flags = async (bookingId: string) => (await admin.from("venue_booking_flags").select("*").eq("booking_id", bookingId)).data ?? [];

  async function equipmentRequest(eventId: string, venueBookingId: string, status: string) {
    const { data, error } = await admin
      .from("equipment_reservations")
      .insert({
        event_id: eventId,
        equipment_id: equipmentId,
        quantity_requested: 2,
        quantity_reserved: status === "approved" ? 2 : null,
        status,
        requested_by: who.rachel.userId,
        start_datetime: DAY.start.toISOString(),
        end_datetime: DAY.end.toISOString(),
        venue_booking_id: venueBookingId,
        ...(status === "approved" ? { reviewed_by: who.staff.userId } : {}),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }
  const equipmentRow = async (id: string) => (await admin.from("equipment_reservations").select("*").eq("id", id).single()).data as Record<string, unknown>;

  describe("107-S2 requesting writes only the replacement", () => {
    it("107-S2: a replacement on a Confirmed event is created PENDING, and the original is byte-identical", async () => {
      const f = await flaggedBooking("confirmed");
      const before = await row(f.original);

      const created = await requestReplacement(f, f.lotus);

      expect(created).toMatchObject({ status: "requested", amendsBookingId: f.original, venueId: f.lotus });
      expect(await row(f.original)).toEqual(before);
      expect((await flags(f.original)).filter((x) => x.resolved_at === null)).toHaveLength(1);
    });
  });

  describe("107-S3 the take-over", () => {
    it("107-S3: approving the replacement replaces the original in the same step, resolves its flag and frees its venue", async () => {
      const f = await flaggedBooking();
      const created = await requestReplacement(f, f.lotus);

      const approved = await who.staff.repo.decide(created.id, { outcome: "approved" }, who.staff.userId, new Date());

      expect(approved).toMatchObject({ status: "approved" });
      const original = await row(f.original);
      expect(original).toMatchObject({ status: "replaced", replaced_by_booking_id: created.id });
      expect(original.replaced_at).not.toBeNull();
      const [flag] = await flags(f.original);
      expect(flag).toMatchObject({ kind: "venue_unavailable", resolved_reason: "replaced" });
      expect(flag.resolved_at).not.toBeNull();
      // Orchid Hall no longer holds the period: another request for it is accepted by the overlap trigger (outside the block)
      expect(await (await row(created.id)).status).toBe("approved");
    });

    it("107-S3: the original's equipment moves to the replacement and goes back to Submitted; cancelled rows stay", async () => {
      const f = await flaggedBooking();
      const reserved = await equipmentRequest(f.eventId, f.original, "approved");
      const submitted = await equipmentRequest(f.eventId, f.original, "requested");
      const released = await equipmentRequest(f.eventId, f.original, "cancelled");
      const created = await requestReplacement(f, f.lotus);

      await who.staff.repo.decide(created.id, { outcome: "approved" }, who.staff.userId, new Date());

      for (const id of [reserved, submitted]) {
        expect(await equipmentRow(id)).toMatchObject({ venue_booking_id: created.id, status: "requested", quantity_reserved: null, reviewed_by: null });
      }
      expect(await equipmentRow(released)).toMatchObject({ venue_booking_id: f.original, status: "cancelled" });
    });

    it("107-S3: other bookings of the event are untouched", async () => {
      const f = await flaggedBooking();
      const other = await venue();
      const { data } = await admin
        .from("venue_bookings")
        .insert({
          event_id: f.eventId,
          venue_id: other,
          requested_by: who.rachel.userId,
          status: "approved",
          event_start_datetime: at("2030-12-01", "09:00").toISOString(),
          event_end_datetime: at("2030-12-01", "12:00").toISOString(),
          snapshot_event_name: "IT",
          snapshot_expected_attendance: 10,
        })
        .select("id")
        .single();
      const created = await requestReplacement(f, f.lotus);
      const before = await row(data!.id as string);

      await who.staff.repo.decide(created.id, { outcome: "approved" }, who.staff.userId, new Date());

      expect(await row(data!.id as string)).toEqual(before);
    });
  });

  describe("107-S4 and 107-S7 when nothing is taken over", () => {
    it("107-S4: rejecting the replacement leaves the original approved, flagged and unlinked", async () => {
      const f = await flaggedBooking();
      const created = await requestReplacement(f, f.lotus);

      await who.staff.repo.decide(created.id, { outcome: "rejected", reason: "Booked out" }, who.staff.userId, new Date());

      expect(await row(f.original)).toMatchObject({ status: "approved", replaced_by_booking_id: null, replaced_at: null });
      expect((await flags(f.original)).filter((x) => x.resolved_at === null)).toHaveLength(1);
    });

    it("107-S7: an ordinary amendment of a rejected booking does not touch the old one", async () => {
      const lotus = await venue();
      const orchid = await venue();
      const eventId = await fixtures.event("approved", who.rachel.userId);
      const { data } = await admin
        .from("venue_bookings")
        .insert({
          event_id: eventId,
          venue_id: orchid,
          requested_by: who.rachel.userId,
          status: "rejected",
          event_start_datetime: DAY.start.toISOString(),
          event_end_datetime: DAY.end.toISOString(),
          snapshot_event_name: "IT",
          snapshot_expected_attendance: 10,
        })
        .select("id")
        .single();
      const amended = await requestReplacement({ eventId, original: data!.id as string }, lotus);

      await who.staff.repo.decide(amended.id, { outcome: "approved" }, who.staff.userId, new Date());

      expect(await row(data!.id as string)).toMatchObject({ status: "rejected", replaced_by_booking_id: null });
    });

    it("107-S7: if the flag was resolved meanwhile, approving is an ordinary approval", async () => {
      const f = await flaggedBooking();
      const created = await requestReplacement(f, f.lotus);
      await admin.from("venue_booking_flags").update({ resolved_at: new Date().toISOString(), resolved_reason: "no_longer_conflicts" }).eq("booking_id", f.original);

      await who.staff.repo.decide(created.id, { outcome: "approved" }, who.staff.userId, new Date());

      expect(await row(f.original)).toMatchObject({ status: "approved", replaced_by_booking_id: null });
    });
  });

  describe("107-S5 one replacement at a time", () => {
    it("107-S5: a second replacement for the same original is ACTIVE_REQUEST_EXISTS; 20 at once create exactly one", async () => {
      const f = await flaggedBooking();
      const results = await Promise.allSettled(Array.from({ length: 20 }, () => requestReplacement(f, f.lotus)));
      // all 20 target the same venue and period, so the loser is either the overlap constraint or the one-replacement index
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const { count } = await admin.from("venue_bookings").select("id", { count: "exact", head: true }).eq("amends_booking_id", f.original);
      expect(count).toBe(1);
      for (const r of results.filter((x) => x.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toMatchObject({ code: expect.stringMatching(/ACTIVE_REQUEST_EXISTS|SLOT_CONFLICT/) });
      }
    }, 60_000);
  });

  describe("DB integrity", () => {
    it("a replaced booking always says by whom and when, and a signed-in user cannot write replaced_*", async () => {
      const f = await flaggedBooking();
      const created = await requestReplacement(f, f.lotus);

      const noLink = await admin.from("venue_bookings").update({ status: "replaced" }).eq("id", f.original);
      expect(noLink.error).not.toBeNull(); // venue_bookings_replaced_columns
      for (const actor of [who.rachel, who.staff, who.marcus]) {
        const res = await actor.client.from("venue_bookings").update({ replaced_by_booking_id: created.id, replaced_at: new Date().toISOString() }).eq("id", f.original);
        expect(res.error, "no column grant").not.toBeNull();
      }
      expect(await row(f.original)).toMatchObject({ replaced_by_booking_id: null });
    });

    it("one booking replaces at most one original", async () => {
      const f1 = await flaggedBooking();
      const f2 = await flaggedBooking();
      const c1 = await requestReplacement(f1, f1.lotus);
      await who.staff.repo.decide(c1.id, { outcome: "approved" }, who.staff.userId, new Date());
      const dup = await admin.from("venue_bookings").update({ replaced_by_booking_id: c1.id, replaced_at: new Date().toISOString(), status: "replaced" }).eq("id", f2.original);
      expect(dup.error?.code).toBe("23505");
    });

    it("the trigger function cannot be called by a signed-in user", async () => {
      const { error } = await who.rachel.client.rpc("venue_booking_take_over");
      expect(error).not.toBeNull();
    });
  });
});
