import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sgtToUtc } from "@spm-t5/shared";
import { DB_ENV, adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-185/AC2 against Postgres (migration 80, docs/specs/venue-block-lifting.md): Venue Staff lift a block with
 * lift_venue_unavailability(); the block and its flags go, each still-affected booking's assigned coordinator gets one
 * venue_block_lifted notification, and the lift is logged. Everyone signs in as a seeded user so the grants and role checks are
 * the real ones; the secret key only arranges fixtures and reads results. Fixtures are throwaway ("IT-") and dated 2030.
 */
const EMAILS = {
  rachel: "rachel.tan@connectsphere.example.com",
  marcus: "marcus.lim@connectsphere.example.com",
  staff: "kenneth.wong@connectsphere.example.com",
  organiser: "jason.chua@techconnect.example.com",
  attendee: "alicia.fernandez@example.com",
};
const at = (date: string, time: string) => sgtToUtc(date, time);
const iso = (d: Date) => d.toISOString();
const BLOCK = { start: at("2030-11-14", "08:00"), end: at("2030-11-16", "18:00") };
const DENIED = "42501";

type Who = keyof typeof EMAILS;
type Actor = { client: SupabaseClient; userId: string };

describe.skipIf(!hasDb || !DB_ENV.publishableKey)("SCRUM-185/AC2 lift a venue unavailability block (migration 80)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<Who, Actor>;

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Who[]) who[key] = await signInAs(EMAILS[key]);
  });
  afterAll(async () => {
    await fixtures.cleanup();
  });

  const venue = () => fixtures.venue("IT-lift");
  const mark = (venueId: string, p = BLOCK, reason = "maintenance") => fixtures.unavailabilityAs(who.staff.client, venueId, p.start, p.end, reason);
  const lift = (actor: Actor, venueId: string, blockId: string) =>
    actor.client.rpc("lift_venue_unavailability", { p_venue_id: venueId, p_block_id: blockId });

  async function hold(venueId: string, p: { start: Date; end: Date }, owner: "rachel" | "marcus" | null = "rachel") {
    const eventId = await fixtures.event("approved", owner ? who[owner].userId : undefined);
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

  const blocksOf = async (venueId: string) => (await admin.from("venue_unavailability").select("id").eq("venue_id", venueId)).data ?? [];
  const openFlags = async (bookingId: string) =>
    (await admin.from("venue_booking_flags").select("*").eq("booking_id", bookingId).is("resolved_at", null)).data ?? [];
  const liftedNotes = async (bookingId: string) =>
    (await admin.from("notifications").select("*").eq("venue_booking_id", bookingId).eq("type", "venue_block_lifted")).data ?? [];
  const lifts = async (venueId: string) =>
    (await admin.from("activity_log").select("*").eq("entity_id", venueId).eq("action_type", "venue_unavailability_lifted")).data ?? [];

  describe("185-S2 Venue Staff lift a block", () => {
    it("SCRUM-185/AC2 185-S2: the block and both flags go, each assigned coordinator gets one notification, and the lift is logged", async () => {
      const venueId = await venue();
      const first = await hold(venueId, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") }, "rachel");
      const second = await hold(venueId, { start: at("2030-11-15", "09:00"), end: at("2030-11-15", "17:00") }, "marcus");
      const blockId = await mark(venueId);
      expect(await openFlags(first)).toHaveLength(1);
      expect(await openFlags(second)).toHaveLength(1);

      const { data, error } = await lift(who.staff, venueId, blockId);

      expect(error).toBeNull();
      expect((data as { flags_cleared: number; notified: number }[])[0]).toEqual({ flags_cleared: 2, notified: 2 });
      expect(await blocksOf(venueId)).toEqual([]);
      expect(await openFlags(first)).toEqual([]);
      expect(await openFlags(second)).toEqual([]);
      const [forRachel] = await liftedNotes(first);
      const [forMarcus] = await liftedNotes(second);
      expect(await liftedNotes(first)).toHaveLength(1);
      expect(await liftedNotes(second)).toHaveLength(1);
      expect(forRachel).toMatchObject({ user_id: who.rachel.userId, type: "venue_block_lifted", is_read: false });
      expect(forMarcus).toMatchObject({ user_id: who.marcus.userId, type: "venue_block_lifted" });
      expect(forRachel.message).toContain("14 Nov 08:00 to 16 Nov 18:00");
      expect(forRachel.message).toContain("Maintenance");
      expect(forRachel.message).toContain("no longer affected");
      const [entry] = await lifts(venueId);
      expect(await lifts(venueId)).toHaveLength(1);
      expect(entry).toMatchObject({ actor_id: who.staff.userId, entity_type: "venue" });
    });

    it("SCRUM-185/AC2 185-S2: the period can be requested again once the block is lifted", async () => {
      const venueId = await venue();
      const blockId = await mark(venueId);
      const args = { p_venue_id: venueId, p_start: iso(at("2030-11-15", "09:00")), p_end: iso(at("2030-11-15", "17:00")) };
      expect((await who.rachel.client.rpc("venue_unavailability_conflicts", args)).data).toHaveLength(1);

      await lift(who.staff, venueId, blockId);

      expect((await who.rachel.client.rpc("venue_unavailability_conflicts", args)).data).toEqual([]);
    });
  });

  describe("185-S2b a block with nothing flagged", () => {
    it("SCRUM-185/AC2 185-S2b: it is removed, nobody is notified and the answer counts zero", async () => {
      const venueId = await venue();
      const blockId = await mark(venueId);

      const { data, error } = await lift(who.staff, venueId, blockId);

      expect(error).toBeNull();
      expect((data as { flags_cleared: number; notified: number }[])[0]).toEqual({ flags_cleared: 0, notified: 0 });
      expect(await blocksOf(venueId)).toEqual([]);
    });
  });

  describe("185-S2c only Venue Staff may lift", () => {
    it.each([
      ["a coordinator", "rachel"],
      ["an organiser", "organiser"],
      ["an attendee", "attendee"],
    ] as const)("SCRUM-185/AC2 185-S2c: %s is refused and the block stays", async (_label, key) => {
      const venueId = await venue();
      const booking = await hold(venueId, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") });
      const blockId = await mark(venueId);

      const { error } = await lift(who[key], venueId, blockId);

      expect(error?.code).toBe(DENIED);
      expect(await blocksOf(venueId)).toHaveLength(1);
      expect(await openFlags(booking)).toHaveLength(1);
      expect(await liftedNotes(booking)).toEqual([]);
    });

    it("SCRUM-185/AC2 185-S2c: nobody can delete a block straight from the table either", async () => {
      const venueId = await venue();
      const blockId = await mark(venueId);

      await who.staff.client.from("venue_unavailability").delete().eq("id", blockId);

      expect(await blocksOf(venueId)).toHaveLength(1);
    });
  });

  describe("185-S2d the block must exist and belong to the venue", () => {
    it("SCRUM-185/AC2 185-S2d: an unknown block is not found", async () => {
      const venueId = await venue();

      const { error } = await lift(who.staff, venueId, crypto.randomUUID());

      expect(error?.code).toBe("P0002");
    });

    it("SCRUM-185/AC2 185-S2d: a block of another venue is not found and stays", async () => {
      const venueId = await venue();
      const otherVenue = await venue();
      const blockId = await mark(otherVenue);

      const { error } = await lift(who.staff, venueId, blockId);

      expect(error?.code).toBe("P0002");
      expect(await blocksOf(otherVenue)).toHaveLength(1);
    });
  });

  describe("185-S2e only open flags tell anyone", () => {
    it("SCRUM-185/AC2 185-S2e: a flag already resolved tells nobody, an open one tells its coordinator", async () => {
      const venueId = await venue();
      const resolved = await hold(venueId, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") }, "marcus");
      const open = await hold(venueId, { start: at("2030-11-15", "09:00"), end: at("2030-11-15", "17:00") }, "rachel");
      const blockId = await mark(venueId);
      await admin
        .from("venue_booking_flags")
        .update({ resolved_at: new Date().toISOString(), resolved_reason: "replaced" })
        .eq("booking_id", resolved);

      const { data } = await lift(who.staff, venueId, blockId);

      expect((data as { flags_cleared: number; notified: number }[])[0]).toEqual({ flags_cleared: 1, notified: 1 });
      expect(await liftedNotes(resolved)).toEqual([]);
      expect(await liftedNotes(open)).toHaveLength(1);
    });

    it("SCRUM-185/AC2 185-S2e: an event with no assigned coordinator tells nobody, and the lift still happens", async () => {
      const venueId = await venue();
      const booking = await hold(venueId, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") }, null);
      const blockId = await mark(venueId);

      const { data, error } = await lift(who.staff, venueId, blockId);

      expect(error).toBeNull();
      expect((data as { flags_cleared: number; notified: number }[])[0]).toEqual({ flags_cleared: 1, notified: 0 });
      expect(await liftedNotes(booking)).toEqual([]);
      expect(await blocksOf(venueId)).toEqual([]);
    });
  });

  describe("185-S2f still flagged by another block", () => {
    it("SCRUM-185/AC2 185-S2f: the coordinator is told it is still affected, and the other flag stays", async () => {
      const venueId = await venue();
      const booking = await hold(venueId, { start: at("2030-11-15", "09:00"), end: at("2030-11-15", "17:00") });
      const first = await mark(venueId);
      const second = await mark(venueId, { start: at("2030-11-15", "12:00"), end: at("2030-11-15", "20:00") }, "safety");
      expect(await openFlags(booking)).toHaveLength(2);

      await lift(who.staff, venueId, first);

      const [note] = await liftedNotes(booking);
      expect(await liftedNotes(booking)).toHaveLength(1);
      expect(note.message).toContain("still affected by another unavailable period");
      expect(note.message).not.toContain("is no longer affected by it.");
      const left = await openFlags(booking);
      expect(left).toHaveLength(1);
      expect(left[0].unavailability_id).toBe(second);
    });
  });
});
