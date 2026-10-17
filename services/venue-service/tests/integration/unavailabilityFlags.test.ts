import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { flaggedBookingMessage, sgtToUtc } from "@spm-t5/shared";
import type { NewBooking } from "../../src/domain/types";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { DB_ENV, adminClient, Fixtures, hasDb, signInAs } from "./support/db";

/**
 * SCRUM-106 against Postgres (migration 44, docs/specs/venue-unavailability-flags.md): marking a block flags the holding, future
 * bookings it overlaps (setup and turnaround included), writes one notification for each event's assigned coordinator in the
 * same transaction, and leaves the booking and its event untouched. Everyone signs in as a seeded user, so the grants, row
 * policies and role checks are the real ones; the secret key only arranges fixtures and reads results. Fixtures are throwaway
 * ("IT-") and dated 2030. The story's example: Orchid Hall (setup 30) blocked 14 Nov 08:00 to 16 Nov 18:00.
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
type Actor = { client: SupabaseClient; userId: string; repo: SupabaseBookingRepository };

describe.skipIf(!hasDb || !DB_ENV.publishableKey)("SCRUM-106 flag bookings affected by venue unavailability (migration 44)", () => {
  const admin = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(admin);
  const who = {} as Record<Who, Actor>;

  beforeAll(async () => {
    for (const key of Object.keys(EMAILS) as Who[]) {
      const { client, userId } = await signInAs(EMAILS[key]);
      who[key] = { client, userId, repo: new SupabaseBookingRepository(client) };
    }
  });
  afterAll(async () => {
    await fixtures.cleanup();
  });

  const orchid = (setup = 0, turnaround = 0) => fixtures.venue("IT-orchid", { setup_minutes: setup, turnaround_minutes: turnaround });

  /** Venue Staff mark a block, as the app does; returns the function's row (block_id, flagged_count). */
  async function mark(venueId: string, p: { start: Date; end: Date } = BLOCK, reason = "maintenance", notes: string | null = null) {
    const { data, error } = await who.staff.client.rpc("mark_venue_unavailable", {
      p_venue_id: venueId,
      p_start: iso(p.start),
      p_end: iso(p.end),
      p_reason: reason,
      p_notes: notes,
    });
    if (error) throw new Error(`${error.code}: ${error.message}`);
    return (data as { block_id: string; flagged_count: number }[])[0]!;
  }

  /** A booking arranged with the secret key, for an event whose assigned coordinator is `owner` (or nobody). */
  async function hold(venueId: string, p: { start: Date; end: Date }, owner: "rachel" | "marcus" | null = "rachel", status = "approved") {
    const eventId = await fixtures.event("approved", owner ? who[owner].userId : undefined);
    const { data, error } = await admin
      .from("venue_bookings")
      .insert({
        event_id: eventId,
        venue_id: venueId,
        requested_by: who.rachel.userId,
        status,
        event_start_datetime: iso(p.start),
        event_end_datetime: iso(p.end),
        snapshot_event_name: "IT",
        snapshot_expected_attendance: 10,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: data.id as string, eventId };
  }

  const openFlags = async (bookingId: string) =>
    (await admin.from("venue_booking_flags").select("*").eq("booking_id", bookingId).is("resolved_at", null)).data ?? [];
  const notificationsFor = async (bookingId: string) =>
    (await admin.from("notifications").select("*").eq("venue_booking_id", bookingId)).data ?? [];
  const row = async (table: "venue_bookings" | "events", id: string) => (await admin.from(table).select("*").eq("id", id).single()).data;

  describe("106-S1 an affected booking is flagged, not changed", () => {
    it("106-S1: the 14 Nov 09:00-17:00 booking gets one open venue_unavailable flag; it stays approved and nothing else is written", async () => {
      const venue = await orchid();
      const booking = await hold(venue, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") });
      const bookingBefore = await row("venue_bookings", booking.id);
      const eventBefore = await row("events", booking.eventId);

      const result = await mark(venue);

      expect(result.flagged_count).toBe(1);
      const flags = await openFlags(booking.id);
      expect(flags).toHaveLength(1);
      expect(flags[0]).toMatchObject({ kind: "venue_unavailable", unavailability_id: result.block_id, other_booking_id: null });
      expect(new Date(flags[0].other_start as string)).toEqual(BLOCK.start);
      expect(new Date(flags[0].other_end as string)).toEqual(BLOCK.end);
      expect(await row("venue_bookings", booking.id)).toEqual(bookingBefore);
      expect(await row("events", booking.eventId)).toEqual(eventBefore);
      expect(bookingBefore).toMatchObject({ status: "approved" });
    });
  });

  describe("106-S2 the assigned coordinator is notified", () => {
    it("106-S2: exactly one notification for Rachel with the event, venue, periods and reason; the SQL wording equals the TypeScript", async () => {
      const venue = await orchid();
      const p = { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") };
      const booking = await hold(venue, p);
      const event = (await row("events", booking.eventId)) as { name: string };
      const venueName = ((await admin.from("venues").select("name").eq("id", venue).single()).data as { name: string }).name;

      await mark(venue);

      const notes = await notificationsFor(booking.id);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        user_id: who.rachel.userId,
        event_id: booking.eventId,
        venue_booking_id: booking.id,
        type: "venue_booking_flagged",
        title: "Venue unavailable – alternative needed",
        is_read: false,
      });
      // parity: the message built in SQL is the message the shared helper builds for the same inputs
      expect(notes[0].message).toBe(
        flaggedBookingMessage({
          eventName: event.name,
          venueName,
          bookingStart: p.start,
          bookingEnd: p.end,
          blockStart: BLOCK.start,
          blockEnd: BLOCK.end,
          reason: "maintenance",
        }),
      );
      expect(notes[0].message).toContain("14 Nov 09:00 to 17:00");
      expect(notes[0].message).toContain("14 Nov 08:00 to 16 Nov 18:00 (Maintenance)");
    });

    it("106-S2: a booking that spans two days and another reason are worded the same way in SQL and TypeScript", async () => {
      const venue = await orchid();
      const p = { start: at("2030-11-14", "20:00"), end: at("2030-11-15", "02:00") };
      const booking = await hold(venue, p);
      const event = (await row("events", booking.eventId)) as { name: string };
      const venueName = ((await admin.from("venues").select("name").eq("id", venue).single()).data as { name: string }).name;

      await mark(venue, BLOCK, "safety");

      const [note] = await notificationsFor(booking.id);
      expect(note.message).toBe(
        flaggedBookingMessage({ eventName: event.name, venueName, bookingStart: p.start, bookingEnd: p.end, blockStart: BLOCK.start, blockEnd: BLOCK.end, reason: "safety" }),
      );
      expect(note.message).toContain("14 Nov 20:00 to 15 Nov 02:00");
      expect(note.message).toContain("(Safety concern)");
    });

    it("106-S2: the coordinator can read the notification as themselves, and mark it read", async () => {
      const venue = await orchid();
      const booking = await hold(venue, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") });
      await mark(venue);

      const { data } = await who.rachel.client.from("notifications").select("id, venue_booking_id").eq("venue_booking_id", booking.id);
      expect(data).toHaveLength(1);
      const { error } = await who.rachel.client.from("notifications").update({ is_read: true }).eq("id", data![0].id);
      expect(error).toBeNull();
    });
  });

  describe("106-S3 a Pending request is flagged too, and cannot be approved", () => {
    it("106-S3: flagged and notified; approve is BOOKING_FLAGGED, the database trigger says CS104, reject still works", async () => {
      const venue = await orchid();
      const pending = await hold(venue, { start: at("2030-11-15", "09:00"), end: at("2030-11-15", "12:00") }, "rachel", "requested");

      await mark(venue);

      expect(await openFlags(pending.id)).toHaveLength(1);
      expect(await notificationsFor(pending.id)).toHaveLength(1);
      await expect(who.staff.repo.decide(pending.id, { outcome: "approved" }, who.staff.userId, new Date())).rejects.toMatchObject({
        code: "BOOKING_FLAGGED",
        httpStatus: 409,
      });
      const direct = await admin.from("venue_bookings").update({ status: "approved" }).eq("id", pending.id);
      expect(direct.error?.code).toBe("CS104");
      expect(await who.staff.repo.decide(pending.id, { outcome: "rejected", reason: "Venue is closed" }, who.staff.userId, new Date())).toMatchObject({
        status: "rejected",
      });
    });
  });

  describe("106-S4 setup and turnaround count (boundary)", () => {
    it("106-S4: with setup 30 a booking at 18:15 occupies from 17:45 and is flagged and its coordinator notified", async () => {
      const venue = await orchid(30);
      const inside = await hold(venue, { start: at("2030-11-16", "18:15"), end: at("2030-11-16", "20:00") });

      const result = await mark(venue);

      expect(result.flagged_count).toBe(1);
      expect(await openFlags(inside.id)).toHaveLength(1);
      expect(await notificationsFor(inside.id)).toHaveLength(1);
    });

    it("106-S4: in a separate fixture a booking at 18:30 occupies from 18:00, only touches the block, and is not flagged", async () => {
      const venue = await orchid(30);
      const touching = await hold(venue, { start: at("2030-11-16", "18:30"), end: at("2030-11-16", "20:00") });

      const result = await mark(venue);

      expect(result.flagged_count).toBe(0);
      expect(await openFlags(touching.id)).toEqual([]);
      expect(await notificationsFor(touching.id)).toEqual([]);
    });

    it("106-S4: turnaround counts at the start of the block as well", async () => {
      const venue = await orchid(0, 30);
      // ends 07:45, occupied until 08:15, which reaches into a block that starts at 08:00
      const before = await hold(venue, { start: at("2030-11-14", "06:00"), end: at("2030-11-14", "07:45") });
      expect((await mark(venue)).flagged_count).toBe(1);
      expect(await openFlags(before.id)).toHaveLength(1);
    });
  });

  describe("106-S5 only the affected coordinator is told", () => {
    it("106-S5: one affected booking writes exactly one notification, for its coordinator and nobody else", async () => {
      const venue = await orchid();
      const booking = await hold(venue, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") }, "rachel");
      const elsewhere = await hold(await orchid(), { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") }, "marcus");
      const outside = await hold(venue, { start: at("2030-11-20", "09:00"), end: at("2030-11-20", "17:00") }, "marcus");

      await mark(venue);

      // exactly one row for the three bookings of this test (a table-wide count would also see other test files' rows)
      const { data: rows } = await admin.from("notifications").select("id").in("venue_booking_id", [booking.id, elsewhere.id, outside.id]);
      expect(rows).toHaveLength(1);
      expect((await notificationsFor(booking.id)).map((n) => n.user_id)).toEqual([who.rachel.userId]);
      expect(await openFlags(elsewhere.id)).toEqual([]);
      expect(await openFlags(outside.id)).toEqual([]);
      for (const other of ["marcus", "organiser", "attendee", "staff"] as const) {
        const { data } = await admin.from("notifications").select("id").eq("user_id", who[other].userId).eq("venue_booking_id", booking.id);
        expect(data, other).toEqual([]);
      }
    });

    it("106-S5: a booking whose event has no assigned coordinator is flagged and nobody is notified", async () => {
      const venue = await orchid();
      const orphan = await hold(venue, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") }, null);

      const result = await mark(venue);

      expect(result.flagged_count).toBe(1);
      expect(await openFlags(orphan.id)).toHaveLength(1);
      expect(await notificationsFor(orphan.id)).toEqual([]);
    });

    it("106-S5: after a reassignment the new coordinator is told, not whoever submitted the request", async () => {
      const venue = await orchid();
      const booking = await hold(venue, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") }, "rachel");
      await admin.from("events").update({ assigned_coordinator_id: who.marcus.userId }).eq("id", booking.eventId);

      await mark(venue);

      expect((await notificationsFor(booking.id)).map((n) => n.user_id)).toEqual([who.marcus.userId]);
    });
  });

  describe("106-S6 what is not flagged", () => {
    it("106-S6: a block that overlaps nothing returns 0 and writes no flag and no notification", async () => {
      const venue = await orchid();
      const far = await hold(venue, { start: at("2030-12-20", "09:00"), end: at("2030-12-20", "17:00") });

      const result = await mark(venue);

      expect(result.flagged_count).toBe(0);
      expect(await openFlags(far.id)).toEqual([]);
      expect(await notificationsFor(far.id)).toEqual([]);
    });

    it.each(["rejected", "withdrawn", "cancelled"])("106-S6: a %s booking inside the block is not flagged", async (status) => {
      const venue = await orchid();
      const closed = await hold(venue, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") }, "rachel", status);
      expect((await mark(venue)).flagged_count).toBe(0);
      expect(await openFlags(closed.id)).toEqual([]);
    });

    it("106-S6: a booking that has already ended is history and is not flagged", async () => {
      const venue = await orchid();
      const past = await hold(venue, { start: at("2020-11-14", "09:00"), end: at("2020-11-14", "17:00") });
      expect((await mark(venue, { start: at("2020-11-14", "08:00"), end: at("2020-11-16", "18:00") })).flagged_count).toBe(0);
      expect(await openFlags(past.id)).toEqual([]);
    });

    it("106-S6: a booking that only touches the block's end is not flagged", async () => {
      const venue = await orchid();
      const touching = await hold(venue, { start: at("2030-11-16", "18:00"), end: at("2030-11-16", "20:00") });
      expect((await mark(venue)).flagged_count).toBe(0);
      expect(await openFlags(touching.id)).toEqual([]);
    });
  });

  describe("106-S7 flags are idempotent and independent", () => {
    it("106-S7: a second block over the same booking adds a second flag and a second notification; each block flags it once", async () => {
      const venue = await orchid();
      const booking = await hold(venue, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") });

      const first = await mark(venue);
      const second = await mark(venue, { start: at("2030-11-14", "12:00"), end: at("2030-11-15", "12:00") }, "renovation");

      expect(first.flagged_count).toBe(1);
      expect(second.flagged_count).toBe(1);
      expect(await openFlags(booking.id)).toHaveLength(2);
      expect(await notificationsFor(booking.id)).toHaveLength(2);
      // refreshing again (a Venue Staff timing save) never raises the same flag twice
      await who.staff.client.rpc("set_venue_timing", { p_venue_id: venue, p_setup: 0, p_turnaround: 0 });
      expect(await openFlags(booking.id)).toHaveLength(2);
      expect(await notificationsFor(booking.id)).toHaveLength(2);
    });

    it("106-S7: resolving buffer conflicts does not close the unavailable flag", async () => {
      const venue = await orchid(30);
      const a = await hold(venue, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "12:00") }, "rachel");
      const b = await hold(venue, { start: at("2030-11-14", "13:00"), end: at("2030-11-14", "17:00") }, "marcus");
      await mark(venue);
      await who.staff.client.rpc("set_venue_timing", { p_venue_id: venue, p_setup: 45, p_turnaround: 45 }); // 12:00 + 45 and 13:00 - 45 clash
      expect((await openFlags(a.id)).map((f) => f.kind).sort()).toEqual(["buffer_conflict", "venue_unavailable"]);

      await who.staff.client.rpc("set_venue_timing", { p_venue_id: venue, p_setup: 0, p_turnaround: 0 }); // 15/15 style: the clash is gone

      expect((await openFlags(a.id)).map((f) => f.kind)).toEqual(["venue_unavailable"]);
      expect((await openFlags(b.id)).map((f) => f.kind)).toEqual(["venue_unavailable"]);
    });

    it("106-S7: a flag clears when its booking is cancelled", async () => {
      const venue = await orchid();
      const booking = await hold(venue, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") });
      await mark(venue);
      expect(await openFlags(booking.id)).toHaveLength(1);

      await admin.from("venue_bookings").update({ status: "cancelled" }).eq("id", booking.id);

      expect(await openFlags(booking.id)).toEqual([]);
    });
  });

  describe("106-S8 who can read and write what", () => {
    it("106-S8: venue staff and the assigned coordinator read the flag; another coordinator, the organiser and an attendee do not", async () => {
      const venue = await orchid();
      const booking = await hold(venue, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") }, "rachel");
      await mark(venue);

      for (const reader of ["staff", "rachel"] as const) {
        const { data } = await who[reader].client.from("venue_booking_flags").select("id").eq("booking_id", booking.id);
        expect(data, reader).toHaveLength(1);
      }
      for (const reader of ["marcus", "organiser", "attendee"] as const) {
        const { data } = await who[reader].client.from("venue_booking_flags").select("id").eq("booking_id", booking.id);
        expect(data, reader).toEqual([]);
      }
    });

    it("106-S8: the flag read through the repository carries the block's id and reason for a coordinator", async () => {
      const venue = await orchid();
      const booking = await hold(venue, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") }, "rachel");
      const { block_id } = await mark(venue, BLOCK, "equipment_failure");

      const flags = await who.rachel.repo.flagsFor([booking.id]);

      expect(flags).toMatchObject([{ kind: "venue_unavailable", unavailabilityId: block_id, unavailabilityReason: "equipment_failure", otherBookingId: null }]);
    });

    it("106-S8: nobody signed in can insert a flag or a notification, or call the internal functions", async () => {
      const venue = await orchid();
      const booking = await hold(venue, { start: at("2030-11-14", "09:00"), end: at("2030-11-14", "17:00") }, "rachel");
      const { block_id } = await mark(venue);

      for (const actor of [who.staff, who.rachel, who.organiser]) {
        const flag = await actor.client.from("venue_booking_flags").insert({ booking_id: booking.id, kind: "venue_unavailable", unavailability_id: block_id });
        expect(flag.error, "flag").not.toBeNull();
        const note = await actor.client
          .from("notifications")
          .insert({ user_id: who.rachel.userId, type: "venue_booking_flagged", title: "x", message: "y" });
        expect(note.error, "notification").not.toBeNull();
        expect((await actor.client.rpc("refresh_venue_booking_flags", { p_venue_id: venue })).error?.code, "refresh").toBe(DENIED);
      }
    });

    it("106-S8: only venue staff can mark a block (unchanged from SCRUM-105)", async () => {
      const venue = await orchid();
      const { error } = await who.rachel.client.rpc("mark_venue_unavailable", {
        p_venue_id: venue,
        p_start: iso(BLOCK.start),
        p_end: iso(BLOCK.end),
        p_reason: "maintenance",
        p_notes: null,
      });
      expect(error?.code).toBe(DENIED);
    });
  });

  describe("a block against a request at the same moment", () => {
    it("106-S9: 20 rounds never deadlock and never leave a booking inside a block without a flag", async () => {
      for (let run = 0; run < 20; run++) {
        const venue = await orchid();
        const eventId = await fixtures.event("approved", who.rachel.userId);
        const p = { start: at("2030-12-05", "09:00"), end: at("2030-12-05", "12:00") };
        const input: NewBooking = {
          eventId,
          venueId: venue,
          ...p,
          requestedBy: who.rachel.userId,
          snapshot: { eventName: "IT", expectedAttendance: 50, venueRequirements: null, accessibilityNeeds: null },
        };

        const [block, booking] = await Promise.allSettled([
          mark(venue, { start: at("2030-12-05", "08:00"), end: at("2030-12-05", "18:00") }),
          who.rachel.repo.insert(input),
        ]);

        expect(block.status, `run ${run}`).toBe("fulfilled");
        if (booking.status === "rejected") {
          expect(booking.reason, `run ${run}`).toMatchObject({ code: "VENUE_UNAVAILABLE" });
        } else {
          // the request won the lock: the block's refresh saw it, so it is flagged and its coordinator told
          expect(await openFlags(booking.value.id), `run ${run}`).toHaveLength(1);
          expect(await notificationsFor(booking.value.id), `run ${run}`).toHaveLength(1);
        }
      }
    }, 180_000);
  });
});
