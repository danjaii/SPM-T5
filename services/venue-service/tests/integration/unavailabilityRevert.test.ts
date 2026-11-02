import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sgtToUtc } from "@spm-t5/shared";
import { DB_ENV, adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-185/AC1 against Postgres (migration 82, docs/specs/venue-block-reverts-event.md): marking a block returns a Confirmed
 * event whose booking it flags to Planning, in the same transaction, keeping the event and its booking, revoking its Safety
 * Approval, writing one status history row and one notification for the assigned coordinator. Other statuses are only flagged.
 * Everyone signs in as a seeded user, so the grants, row policies and role checks are the real ones; the secret key only
 * arranges fixtures and reads results. Fixtures are throwaway ("IT-") and dated 2030.
 */
const EMAILS = {
  rachel: "rachel.tan@connectsphere.example.com",
  staff: "kenneth.wong@connectsphere.example.com",
};
const at = (date: string, time: string) => sgtToUtc(date, time);
const iso = (d: Date) => d.toISOString();
const BLOCK = { start: at("2030-11-14", "08:00"), end: at("2030-11-16", "18:00") };

type Who = keyof typeof EMAILS;
type Actor = { client: SupabaseClient; userId: string };

describe.skipIf(!hasDb || !DB_ENV.publishableKey)("SCRUM-185/AC1 a venue block returns a Confirmed event to Planning (migration 82)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<Who, Actor>;
  let safetyOfficerId = "";

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Who[]) who[key] = await signInAs(EMAILS[key]);
    const { data, error } = await admin.from("users").select("id").eq("role", "safety_officer").limit(1).single();
    if (error) throw new Error(`Need a seeded safety officer (run supabase db reset): ${error.message}`);
    safetyOfficerId = data.id as string;
  });
  afterAll(async () => {
    await fixtures.cleanup();
  });

  const venue = () => fixtures.venue("IT-revert");
  const mark = async (venueId: string, p = BLOCK, reason = "maintenance") => {
    const { data, error } = await who.staff.client.rpc("mark_venue_unavailable", {
      p_venue_id: venueId,
      p_start: iso(p.start),
      p_end: iso(p.end),
      p_reason: reason,
      p_notes: null,
    });
    if (error) throw new Error(`${error.code}: ${error.message}`);
    return (data as { block_id: string; flagged_count: number }[])[0]!;
  };

  /** An event in `status` (coordinator Rachel, or nobody) with an approved booking in the given period, and a Safety Approval. */
  async function arrange(venueId: string, status: string, owner: "rachel" | null = "rachel", period = { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") }) {
    const eventId = await fixtures.event(status, owner ? who[owner].userId : undefined);
    const booking = await bookAt(eventId, venueId, period);
    const { error } = await admin.from("safety_checks").insert({ event_id: eventId, decided_by: safetyOfficerId, decision: "approved" });
    if (error) throw new Error(error.message);
    return { eventId, bookingId: booking };
  }
  async function bookAt(eventId: string, venueId: string, p: { start: Date; end: Date }) {
    const { data, error } = await admin
      .from("venue_bookings")
      .insert({
        event_id: eventId,
        venue_id: venueId,
        requested_by: who.rachel.userId,
        status: "approved",
        event_start_datetime: iso(p.start),
        event_end_datetime: iso(p.end),
        snapshot_event_name: "IT",
        snapshot_expected_attendance: 10,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  const eventRow = async (id: string) => (await admin.from("events").select("*").eq("id", id).single()).data!;
  const bookingRow = async (id: string) => (await admin.from("venue_bookings").select("*").eq("id", id).single()).data!;
  const history = async (eventId: string) => (await admin.from("event_status_history").select("*").eq("event_id", eventId)).data ?? [];
  const returnedNotes = async (eventId: string) =>
    (await admin.from("notifications").select("*").eq("event_id", eventId).eq("type", "event_returned_to_planning")).data ?? [];
  const activeApprovals = async (eventId: string) =>
    (await admin.from("safety_checks").select("id").eq("event_id", eventId).eq("decision", "approved").is("revoked_at", null)).data ?? [];

  describe("185-S1 a block returns a Confirmed event to Planning", () => {
    it("SCRUM-185/AC1 185-S1: the event goes to Planning, kept; its booking and data are untouched; history, revoked approval and one notice", async () => {
      const venueId = await venue();
      const { eventId, bookingId } = await arrange(venueId, "confirmed");
      const eventBefore = await eventRow(eventId);
      const bookingBefore = await bookingRow(bookingId);
      expect(await activeApprovals(eventId)).toHaveLength(1);

      await mark(venueId);

      const after = await eventRow(eventId);
      expect(after.status).toBe("planning");
      expect({ ...after, status: undefined, updated_at: undefined }).toEqual({ ...eventBefore, status: undefined, updated_at: undefined });
      expect(await bookingRow(bookingId)).toEqual(bookingBefore);
      expect(bookingBefore).toMatchObject({ status: "approved" });
      expect(await activeApprovals(eventId)).toEqual([]);
      const rows = await history(eventId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ old_status: "confirmed", new_status: "planning", changed_by: who.staff.userId });
      expect(rows[0].reason).toContain("is unavailable from 14 Nov 08:00 to 16 Nov 18:00 (Maintenance)");
      const notes = await returnedNotes(eventId);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ user_id: who.rachel.userId, title: "Event returned to Planning", is_read: false });
      expect(notes[0].message).toContain("14 Nov 08:00 to 16 Nov 18:00 (Maintenance)");
      expect(notes[0].message).toContain("returned to Planning");
    });

    it("SCRUM-185/AC1 185-S1: the coordinator still gets SCRUM-106's flag notice for the booking, which is a separate message", async () => {
      const venueId = await venue();
      const { eventId, bookingId } = await arrange(venueId, "confirmed");

      await mark(venueId);

      const flagged = (await admin.from("notifications").select("type").eq("venue_booking_id", bookingId).eq("type", "venue_booking_flagged")).data ?? [];
      expect(flagged).toHaveLength(1);
      expect(await returnedNotes(eventId)).toHaveLength(1);
    });

    it("SCRUM-185/AC1 185-S1: the coordinator can read the notification and the event is not cancelled", async () => {
      const venueId = await venue();
      const { eventId } = await arrange(venueId, "confirmed");

      await mark(venueId);

      const { data } = await who.rachel.client.from("notifications").select("id, type").eq("event_id", eventId).eq("type", "event_returned_to_planning");
      expect(data).toHaveLength(1);
      expect((await eventRow(eventId)).status).not.toBe("cancelled");
    });
  });

  describe("185-S1b only a Confirmed event goes back", () => {
    it.each(["approved", "planning", "awaiting_arrangements"])("SCRUM-185/AC1 185-S1b: an event in %s keeps its status and gets no returned notice, but is flagged", async (status) => {
      const venueId = await venue();
      const { eventId, bookingId } = await arrange(venueId, status);

      await mark(venueId);

      expect((await eventRow(eventId)).status).toBe(status);
      expect(await history(eventId)).toEqual([]);
      expect(await returnedNotes(eventId)).toEqual([]);
      expect(await activeApprovals(eventId)).toHaveLength(1);
      expect((await admin.from("venue_booking_flags").select("id").eq("booking_id", bookingId).is("resolved_at", null)).data).toHaveLength(1);
    });
  });

  describe("185-S1c a block that touches nothing", () => {
    it("SCRUM-185/AC1 185-S1c: a Confirmed event whose booking the block does not overlap stays Confirmed", async () => {
      const venueId = await venue();
      const { eventId } = await arrange(venueId, "confirmed", "rachel", { start: at("2030-12-20", "09:00"), end: at("2030-12-20", "17:00") });

      await mark(venueId);

      expect((await eventRow(eventId)).status).toBe("confirmed");
      expect(await history(eventId)).toEqual([]);
      expect(await returnedNotes(eventId)).toEqual([]);
    });

    it("SCRUM-185/AC1 185-S1c: a block on another venue does not touch it either", async () => {
      const venueId = await venue();
      const otherVenue = await venue();
      const { eventId } = await arrange(venueId, "confirmed");

      await mark(otherVenue);

      expect((await eventRow(eventId)).status).toBe("confirmed");
    });
  });

  describe("185-S1d several bookings of one event", () => {
    it("SCRUM-185/AC1 185-S1d: the event changes status once: one history row and one returned notice", async () => {
      const venueId = await venue();
      const { eventId } = await arrange(venueId, "confirmed");
      await bookAt(eventId, venueId, { start: at("2030-11-15", "09:00"), end: at("2030-11-15", "17:00") });

      const result = await mark(venueId);

      expect(result.flagged_count).toBe(2);
      expect((await eventRow(eventId)).status).toBe("planning");
      expect(await history(eventId)).toHaveLength(1);
      expect(await returnedNotes(eventId)).toHaveLength(1);
    });
  });

  describe("185-S1e no assigned coordinator", () => {
    it("SCRUM-185/AC1 185-S1e: the event still goes to Planning, and nobody is told of it", async () => {
      const venueId = await venue();
      const { eventId } = await arrange(venueId, "confirmed", null);

      await mark(venueId);

      expect((await eventRow(eventId)).status).toBe("planning");
      expect(await returnedNotes(eventId)).toEqual([]);
      expect(await history(eventId)).toHaveLength(1);
    });
  });

  describe("185-S1 the block is one transaction with the change", () => {
    it("SCRUM-185/AC1 185-S1: a block that is refused changes nothing (the end must follow the start)", async () => {
      const venueId = await venue();
      const { eventId } = await arrange(venueId, "confirmed");

      await expect(mark(venueId, { start: BLOCK.end, end: BLOCK.start })).rejects.toThrow("22023");

      expect((await eventRow(eventId)).status).toBe("confirmed");
    });

    it("SCRUM-185/AC1 185-S1: only Venue Staff can cause it (a coordinator cannot mark a block, so cannot revert an event)", async () => {
      const venueId = await venue();
      const { eventId } = await arrange(venueId, "confirmed");

      const { error } = await who.rachel.client.rpc("mark_venue_unavailable", {
        p_venue_id: venueId,
        p_start: iso(BLOCK.start),
        p_end: iso(BLOCK.end),
        p_reason: "maintenance",
        p_notes: null,
      });

      expect(error?.code).toBe("42501");
      expect((await eventRow(eventId)).status).toBe("confirmed");
    });
  });
});
