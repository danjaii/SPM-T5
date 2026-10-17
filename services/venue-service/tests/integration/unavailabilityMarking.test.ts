import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sgtToUtc } from "@spm-t5/shared";
import type { NewBooking } from "../../src/domain/types";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-105: marking a venue unavailable (migrations 38 and 39) against Postgres. Everyone signs in as a seeded user, so the
 * grants, the row policies and the role checks inside the functions are exercised for real; the secret key (service role)
 * only arranges fixtures and checks results. Fixtures are throwaway ("IT-") and dated 2030. The block in the examples is the
 * story's: 14 Nov 08:00 to 16 Nov 18:00, Orchid Hall with setup 30.
 */
const EMAILS = {
  coordinator: "rachel.tan@connectsphere.example.com",
  otherCoordinator: "marcus.lim@connectsphere.example.com",
  venueStaff: "kenneth.wong@connectsphere.example.com",
  technicalSupport: "aaron.koh@connectsphere.example.com",
  attendee: "alicia.fernandez@example.com",
};
const DENIED = "42501";
const INVALID = "22023";
const BLOCKED = "CS105";
const at = (date: string, time: string) => sgtToUtc(date, time);
const iso = (d: Date) => d.toISOString();
const BLOCK = { start: at("2030-11-14", "08:00"), end: at("2030-11-16", "18:00") };

type Actor = { client: SupabaseClient; userId: string; repo: SupabaseBookingRepository };

describe.skipIf(!hasDb)("SCRUM-105 venue unavailability (migrations 38 and 39)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<keyof typeof EMAILS, Actor>;

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as (keyof typeof EMAILS)[]) {
      const { client, userId } = await signInAs(EMAILS[key]);
      who[key] = { client, userId, repo: new SupabaseBookingRepository(client) };
    }
  });
  afterAll(async () => {
    await fixtures.cleanup();
  });

  const orchid = (setup = 30, turnaround = 0) => fixtures.venue("IT-orchid", { setup_minutes: setup, turnaround_minutes: turnaround });
  const mark = (venueId: string, p: { start: Date; end: Date } = BLOCK, reason = "maintenance", notes: string | null = null, actor: Actor = who.venueStaff) =>
    actor.client
      .rpc("mark_venue_unavailable", { p_venue_id: venueId, p_start: iso(p.start), p_end: iso(p.end), p_reason: reason, p_notes: notes })
      // migration 44 returns (block_id, flagged_count); these 105 tests only need the block's id
      .then(({ data, error }) => ({ data: (data as { block_id: string }[] | null)?.[0]?.block_id ?? null, error }));

  /** A request made as the coordinator for one of their own events, through RLS, like the app does. */
  async function request(venueId: string, p: { start: Date; end: Date }, side: "coordinator" | "otherCoordinator" = "coordinator") {
    const input: NewBooking = {
      eventId: await fixtures.event("approved", who[side].userId),
      venueId,
      ...p,
      requestedBy: who[side].userId,
      snapshot: { eventName: "IT", expectedAttendance: 50, venueRequirements: null, accessibilityNeeds: null },
    };
    return who[side].repo.insert(input);
  }

  const rowsOf = async (venueId: string) => (await admin.from("venue_unavailability").select("*").eq("venue_id", venueId)).data ?? [];

  describe("105-S1 marking a block", () => {
    it("105-S1: venue staff save the block with the reason, who made it and when, and it is logged", async () => {
      const venue = await orchid();
      const before = Date.now();

      const { data, error } = await mark(venue, BLOCK, "maintenance", "Annual inspection");

      expect(error).toBeNull();
      const rows = await rowsOf(venue);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: data, reason: "maintenance", notes: "Annual inspection", created_by: who.venueStaff.userId });
      expect(new Date(rows[0].start_datetime as string)).toEqual(BLOCK.start);
      expect(new Date(rows[0].end_datetime as string)).toEqual(BLOCK.end);
      expect(new Date(rows[0].created_at as string).getTime()).toBeGreaterThanOrEqual(before - 5000);
      const { data: log } = await admin.from("activity_log").select("actor_id, action_type, entity_type").eq("entity_id", venue);
      expect(log).toEqual([{ actor_id: who.venueStaff.userId, action_type: "venue_unavailability_marked", entity_type: "venue" }]);
    });

    it("105-S1: the new reason Equipment failure (migration 38) saves, and so do the other selectable ones", async () => {
      const venue = await orchid();
      for (const reason of ["equipment_failure", "renovation", "safety"]) {
        const { error } = await mark(venue, { start: at("2030-12-01", "08:00"), end: at("2030-12-02", "08:00") }, reason);
        expect(error, reason).toBeNull();
      }
      expect((await rowsOf(venue)).map((r) => r.reason).sort()).toEqual(["equipment_failure", "renovation", "safety"]);
    });

    it("105-S1: an unknown venue is P0002 and writes nothing", async () => {
      const { error } = await mark("00000000-0000-0000-0000-000000000000");
      expect(error?.code).toBe("P0002");
    });
  });

  describe("105-S2 and 105-S3 the database insists too", () => {
    it.each([
      ["no reason", null],
      ["a blank reason", ""],
      ["internal_activity", "internal_activity"],
      ["an unknown reason", "party"],
    ])("105-S2: %s is 22023 and nothing is saved", async (_name, reason) => {
      const venue = await orchid();
      const { error } = await mark(venue, BLOCK, reason as string);
      expect(error?.code).toBe(INVALID);
      expect(await rowsOf(venue)).toEqual([]);
    });

    it("105-S2: Other without notes is 22023 [PROPOSED]; with notes it saves", async () => {
      const venue = await orchid();
      expect((await mark(venue, BLOCK, "other", "   ")).error?.code).toBe(INVALID);
      expect((await mark(venue, BLOCK, "other", "Wedding photoshoot")).error).toBeNull();
    });

    it("105-S3: an end equal to or before the start is 22023 and nothing is saved", async () => {
      const venue = await orchid();
      expect((await mark(venue, { start: BLOCK.start, end: BLOCK.start })).error?.code).toBe(INVALID);
      expect((await mark(venue, { start: BLOCK.end, end: BLOCK.start })).error?.code).toBe(INVALID);
      expect(await rowsOf(venue)).toEqual([]);
    });
  });

  describe("105-S6 and 105-S7 only a function writes, only some roles read", () => {
    it("105-S6: a coordinator, technical support and an attendee cannot call mark_venue_unavailable", async () => {
      const venue = await orchid();
      for (const actor of [who.coordinator, who.technicalSupport, who.attendee]) {
        expect((await mark(venue, BLOCK, "maintenance", null, actor)).error?.code).toBe(DENIED);
      }
      expect((await admin.rpc("mark_venue_unavailable", { p_venue_id: venue, p_start: iso(BLOCK.start), p_end: iso(BLOCK.end), p_reason: "maintenance", p_notes: null })).error?.code).toBe(DENIED);
      expect(await rowsOf(venue)).toEqual([]);
    });

    it("105-S7: nobody can insert, update or delete a block directly, venue staff included", async () => {
      const venue = await orchid();
      const id = (await mark(venue)).data as string;

      for (const actor of [who.venueStaff, who.coordinator]) {
        const insert = await actor.client
          .from("venue_unavailability")
          .insert({ venue_id: venue, start_datetime: iso(BLOCK.start), end_datetime: iso(BLOCK.end), reason: "maintenance" });
        expect(insert.error?.code).toBe(DENIED);
        expect((await actor.client.from("venue_unavailability").update({ notes: "x" }).eq("id", id)).error?.code).toBe(DENIED);
        expect((await actor.client.from("venue_unavailability").delete().eq("id", id)).error?.code).toBe(DENIED);
      }
      expect(await rowsOf(venue)).toHaveLength(1);
    });

    it("105-S7: venue staff and coordinators read the blocks, others read none, and the seeded blocks still show", async () => {
      const venue = await orchid();
      const id = (await mark(venue)).data as string;

      for (const actor of [who.venueStaff, who.coordinator]) {
        const { data } = await actor.client.from("venue_unavailability").select("id").eq("id", id);
        expect(data, "reads the new block").toEqual([{ id }]);
        const { data: seeded } = await actor.client.from("venue_unavailability").select("id").eq("id", "405a47be-cb01-5b79-8f8c-b142c2d273bf");
        expect(seeded).toHaveLength(1);
      }
      for (const actor of [who.technicalSupport, who.attendee]) {
        const { data } = await actor.client.from("venue_unavailability").select("id").eq("id", id);
        expect(data).toEqual([]);
      }
    });
  });

  describe("105-S4 and 105-S5 the trigger, the pre-check and the search agree", () => {
    it("105-S4: a request inside the block is refused CS105 and nothing is inserted", async () => {
      const venue = await orchid();
      await mark(venue);

      await expect(request(venue, { start: at("2030-11-15", "09:00"), end: at("2030-11-15", "17:00") })).rejects.toMatchObject({ code: "VENUE_UNAVAILABLE", httpStatus: 409 });
      const { count } = await admin.from("venue_bookings").select("id", { count: "exact", head: true }).eq("venue_id", venue);
      expect(count).toBe(0);
    });

    it("105-S5: with setup 30, 18:15-20:00 on 16 Nov is refused and 18:30-20:00 is created Pending", async () => {
      const venue = await orchid(30, 0);
      await mark(venue);

      await expect(request(venue, { start: at("2030-11-16", "18:15"), end: at("2030-11-16", "20:00") })).rejects.toMatchObject({ code: "VENUE_UNAVAILABLE" });
      expect(await request(venue, { start: at("2030-11-16", "18:30"), end: at("2030-11-16", "20:00") })).toMatchObject({ status: "requested" });
    });

    it("105-S5: with turnaround 30, a booking ending 08:00 on 14 Nov is refused and one ending 07:30 is created", async () => {
      const venue = await orchid(0, 30);
      await mark(venue);

      await expect(request(venue, { start: at("2030-11-14", "06:00"), end: at("2030-11-14", "08:00") })).rejects.toMatchObject({ code: "VENUE_UNAVAILABLE" });
      expect(await request(venue, { start: at("2030-11-14", "06:00"), end: at("2030-11-14", "07:30") })).toMatchObject({ status: "requested" });
    });

    it("105-S4: changing a booking into the block is refused too, and the booking is untouched", async () => {
      const venue = await orchid();
      await mark(venue);
      const booking = await request(venue, { start: at("2030-11-20", "09:00"), end: at("2030-11-20", "12:00") });

      await expect(
        who.coordinator.repo.change(booking.id, {
          start: at("2030-11-15", "09:00"),
          end: at("2030-11-15", "12:00"),
          expectedAttendance: 50,
          venueRequirements: null,
        }),
      ).rejects.toMatchObject({ code: "VENUE_UNAVAILABLE" });
      expect((await who.coordinator.repo.getById(booking.id))?.start).toEqual(at("2030-11-20", "09:00"));
    });

    it("105-S4: a held slot still wins: a request that is both held and blocked reports SLOT_CONFLICT", async () => {
      const venue = await orchid();
      const eventId = await fixtures.event("approved", who.otherCoordinator.userId);
      // a booking made before the block, so it already sits inside it when the block is marked
      await admin.from("venue_bookings").insert({ event_id: eventId, venue_id: venue, requested_by: who.otherCoordinator.userId, status: "approved", event_start_datetime: iso(at("2030-11-15", "09:00")), event_end_datetime: iso(at("2030-11-15", "17:00")) });
      await mark(venue);

      await expect(request(venue, { start: at("2030-11-15", "10:00"), end: at("2030-11-15", "12:00") })).rejects.toMatchObject({ code: "SLOT_CONFLICT" });
    });

    it("105-S5: available_venues leaves out a venue whose padded request touches the block and keeps one that only touches it", async () => {
      const venue = await orchid(30, 0);
      await mark(venue);

      const search = async (start: Date, end: Date) => {
        const { data } = await who.coordinator.client.rpc("available_venues", { p_start: iso(start), p_end: iso(end) });
        return (data as string[]).includes(venue);
      };
      expect(await search(at("2030-11-16", "18:15"), at("2030-11-16", "20:00"))).toBe(false);
      expect(await search(at("2030-11-16", "18:30"), at("2030-11-16", "20:00"))).toBe(true);
      expect(await search(at("2030-11-15", "09:00"), at("2030-11-15", "17:00"))).toBe(false);
    });
  });

  describe("105-S8 venue_unavailability_conflicts", () => {
    it("105-S8: returns the overlapping blocks (padded request, unpadded block) with the venue name and no identity", async () => {
      const venue = await orchid(30, 0);
      await mark(venue, BLOCK, "safety", "Secret note");
      const p = (start: string, end: string) => ({ p_venue_id: venue, p_start: iso(at("2030-11-16", start)), p_end: iso(at("2030-11-16", end)) });

      const { data, error } = await who.coordinator.client.rpc("venue_unavailability_conflicts", p("18:15", "20:00"));

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(Object.keys(data[0]).sort()).toEqual(["end_datetime", "reason", "start_datetime", "venue_name"]);
      expect(new Date(data[0].start_datetime)).toEqual(BLOCK.start);
      expect(new Date(data[0].end_datetime)).toEqual(BLOCK.end);
      expect(data[0].reason).toBe("safety");
      expect((await who.coordinator.client.rpc("venue_unavailability_conflicts", p("18:30", "20:00"))).data).toEqual([]);
    });

    it("105-S8: venue staff and coordinators may ask; technical support, an attendee and the secret key get 42501", async () => {
      const venue = await orchid();
      await mark(venue);
      const args = { p_venue_id: venue, p_start: iso(BLOCK.start), p_end: iso(BLOCK.end) };

      for (const actor of [who.venueStaff, who.coordinator]) {
        expect((await actor.client.rpc("venue_unavailability_conflicts", args)).error).toBeNull();
      }
      for (const client of [who.technicalSupport.client, who.attendee.client, admin]) {
        expect((await client.rpc("venue_unavailability_conflicts", args)).error?.code).toBe(DENIED);
      }
    });

    it("105-S8: the repository reads it as the caller and returns the earliest block first", async () => {
      const venue = await orchid(0, 0);
      await mark(venue, { start: at("2030-11-20", "08:00"), end: at("2030-11-21", "08:00") });
      await mark(venue, BLOCK);

      const found = await who.coordinator.repo.unavailabilityConflicts(venue, at("2030-11-14", "00:00"), at("2030-11-30", "00:00"));

      expect(found.map((b) => b.start)).toEqual([BLOCK.start, at("2030-11-20", "08:00")]);
      expect(found[0].venueName).toMatch(/^IT-orchid/);
    });
  });

  describe("a block against a booking at the same moment", () => {
    it("105-S4: 20 rounds of marking a block and requesting the same slot never deadlock, and never leave a booking and a block unexplained", async () => {
      for (let run = 0; run < 20; run++) {
        const venue = await orchid(0, 0);
        const eventId = await fixtures.event("approved", who.coordinator.userId);
        const p = { start: at("2030-12-05", "09:00"), end: at("2030-12-05", "12:00") };
        const insert = who.coordinator.repo.insert({
          eventId,
          venueId: venue,
          ...p,
          requestedBy: who.coordinator.userId,
          snapshot: { eventName: "IT", expectedAttendance: 50, venueRequirements: null, accessibilityNeeds: null },
        });

        const [block, booking] = await Promise.allSettled([mark(venue, { start: at("2030-12-05", "08:00"), end: at("2030-12-05", "18:00") }), insert]);

        // The block always lands (marking never fails because of a request). The request either lost to it (refused) or won the
        // lock first and now sits inside the block, which SCRUM-106 flags; it is never an unexplained error.
        expect(block.status, `run ${run}`).toBe("fulfilled");
        expect((block as PromiseFulfilledResult<{ error: unknown }>).value.error, `run ${run}`).toBeNull();
        if (booking.status === "rejected") {
          expect(booking.reason, `run ${run}`).toMatchObject({ code: "VENUE_UNAVAILABLE" });
          const { count } = await admin.from("venue_bookings").select("id", { count: "exact", head: true }).eq("venue_id", venue);
          expect(count, `run ${run}`).toBe(0);
        } else {
          expect(booking.value, `run ${run}`).toMatchObject({ status: "requested" });
        }
      }
    }, 120_000);
  });

  it("105-S4: the booking trigger reports CS105 with SQLSTATE through the secret key too", async () => {
    const venue = await orchid();
    await mark(venue);
    const eventId = await fixtures.event("approved", who.coordinator.userId);

    const { error } = await admin
      .from("venue_bookings")
      .insert({ event_id: eventId, venue_id: venue, requested_by: who.coordinator.userId, status: "requested", event_start_datetime: iso(at("2030-11-15", "09:00")), event_end_datetime: iso(at("2030-11-15", "17:00")) });

    expect(error?.code).toBe(BLOCKED);
  });
});
