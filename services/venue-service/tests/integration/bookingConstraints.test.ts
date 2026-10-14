import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import type { NewBooking } from "../../src/domain/types";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";
import { adminClient, Fixtures, hasDb } from "./support/db";

// Dates in 2030 keep these throwaway rows away from the seed data.
const period = (date: string, start: string, end: string) => ({
  start: sgtToUtc(date, start),
  end: sgtToUtc(date, end),
});

describe.skipIf(!hasDb)("SCRUM-36 and SCRUM-98 booking constraints against Postgres (migrations 06 and 28)", () => {
  const db = hasDb ? adminClient() : (undefined as never);
  const fixtures = new Fixtures(db);
  const repo = new SupabaseBookingRepository(db);
  let coordinator: string;

  const booking = (eventId: string, venueId: string, p: { start: Date; end: Date }, extra: Partial<NewBooking> = {}) => ({
    eventId,
    venueId,
    ...p,
    requestedBy: coordinator,
    snapshot: { eventName: "IT", expectedAttendance: 50, venueRequirements: null, accessibilityNeeds: null },
    ...extra,
  });

  beforeAll(async () => {
    const { data, error } = await db.from("users").select("id").eq("role", "event_coordinator").limit(1).single();
    if (error) throw new Error(`Need a seeded event_coordinator (run supabase db reset): ${error.message}`);
    coordinator = data.id as string;
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("36-S1 refuses overlapping periods (all five shapes) and reports SLOT_CONFLICT", async () => {
    const venue = await fixtures.venue();
    await repo.insert(booking(await fixtures.event(), venue, period("2030-11-14", "09:00", "17:00")));

    for (const [start, end] of [["13:00", "18:00"], ["09:00", "17:00"], ["10:00", "12:00"], ["08:00", "18:00"], ["16:59", "18:00"]]) {
      await expect(
        repo.insert(booking(await fixtures.event(), venue, period("2030-11-14", start, end))),
      ).rejects.toMatchObject({ code: "SLOT_CONFLICT", httpStatus: 409 });
    }
  });

  it("36-S2 allows back-to-back periods, another date and another venue", async () => {
    const venue = await fixtures.venue();
    const otherVenue = await fixtures.venue();
    await repo.insert(booking(await fixtures.event(), venue, period("2030-11-14", "09:00", "17:00")));

    await repo.insert(booking(await fixtures.event(), venue, period("2030-11-14", "17:00", "18:00")));
    await repo.insert(booking(await fixtures.event(), venue, period("2030-11-14", "07:00", "09:00")));
    await repo.insert(booking(await fixtures.event(), venue, period("2030-11-15", "09:00", "17:00")));
    await repo.insert(booking(await fixtures.event(), otherVenue, period("2030-11-14", "09:00", "17:00")));
  });

  it("36-S3 a rejected or withdrawn holder releases the slot", async () => {
    for (const released of ["rejected", "withdrawn"]) {
      const venue = await fixtures.venue();
      const holder = await repo.insert(booking(await fixtures.event(), venue, period("2030-11-14", "09:00", "17:00")));
      const { error } = await db.from("venue_bookings").update({ status: released }).eq("id", holder.id);
      expect(error).toBeNull();

      await repo.insert(booking(await fixtures.event(), venue, period("2030-11-14", "09:00", "17:00")));
    }
  });

  it("36-S4 two parallel overlapping inserts leave exactly one PENDING row (repeated)", async () => {
    for (let run = 0; run < 20; run++) {
      const venue = await fixtures.venue();
      const [eventA, eventB] = [await fixtures.event(), await fixtures.event()];

      const results = await Promise.allSettled([
        repo.insert(booking(eventA, venue, period("2030-12-01", "09:00", "17:00"))),
        repo.insert(booking(eventB, venue, period("2030-12-01", "13:00", "18:00"))),
      ]);

      expect(results.filter((r) => r.status === "fulfilled"), `run ${run}`).toHaveLength(1);
      const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(rejected?.reason).toMatchObject({ code: "SLOT_CONFLICT" });

      const { count } = await db.from("venue_bookings").select("id", { count: "exact", head: true }).eq("venue_id", venue);
      expect(count, `run ${run}`).toBe(1);
    }
    // 20 runs x ~7 round trips each is well past vitest's 5s default.
  }, 60_000);

  it("36-S5 the refusal exposes nothing about the holder", async () => {
    const venue = await fixtures.venue();
    const holderEvent = await fixtures.event();
    const holder = await repo.insert(booking(holderEvent, venue, period("2030-11-14", "09:00", "17:00")));

    const error = await repo
      .insert(booking(await fixtures.event(), venue, period("2030-11-14", "10:00", "12:00")))
      .catch((e: unknown) => e as { toBody(): unknown });
    const serialised = JSON.stringify(error.toBody());
    expect(serialised).not.toContain(holder.id);
    expect(serialised).not.toContain(holderEvent);
    expect(serialised).not.toContain("duplicate key");
    expect(serialised).not.toContain("conflicting key");
  });

  // SCRUM-98 (migration 28) dropped DR6's one-active-per-event index
  it("98-S2 an event may hold several active bookings, at different venues at the same time", async () => {
    const event = await fixtures.event();
    const first = await repo.insert(booking(event, await fixtures.venue(), period("2030-11-14", "09:00", "17:00")));
    await db.from("venue_bookings").update({ status: "approved" }).eq("id", first.id);

    await repo.insert(booking(event, await fixtures.venue(), period("2030-11-14", "09:00", "17:00")));
    await repo.insert(booking(event, await fixtures.venue(), period("2030-11-14", "13:00", "15:00")));

    const { count } = await db.from("venue_bookings").select("id", { count: "exact", head: true }).eq("event_id", event);
    expect(count).toBe(3);
  });

  // the service refuses this first with DUPLICATE_VENUE; the database still stops it if two requests race past that check
  it("98-S14 the same event cannot hold one venue twice for overlapping periods", async () => {
    const event = await fixtures.event();
    const venue = await fixtures.venue();
    await repo.insert(booking(event, venue, period("2030-11-14", "09:00", "12:00")));

    await expect(repo.insert(booking(event, venue, period("2030-11-14", "11:00", "13:00")))).rejects.toMatchObject({ code: "SLOT_CONFLICT" });
    await repo.insert(booking(event, venue, period("2030-11-14", "12:00", "17:00"))); // back to back is fine (98-S5)
  });

  it("98-S20 a rejected booking has at most one active replacement; a released one frees it", async () => {
    const event = await fixtures.event();
    const rejected = await repo.insert(booking(event, await fixtures.venue(), period("2030-11-14", "09:00", "17:00")));
    await db.from("venue_bookings").update({ status: "rejected" }).eq("id", rejected.id);
    const replacement = await repo.insert(
      booking(event, await fixtures.venue(), period("2030-11-15", "09:00", "17:00"), { amendsBookingId: rejected.id }),
    );

    await expect(
      repo.insert(booking(event, await fixtures.venue(), period("2030-11-16", "09:00", "17:00"), { amendsBookingId: rejected.id })),
    ).rejects.toMatchObject({ code: "ACTIVE_REQUEST_EXISTS" });

    await db.from("venue_bookings").update({ status: "withdrawn" }).eq("id", replacement.id);
    await repo.insert(booking(event, await fixtures.venue(), period("2030-11-16", "09:00", "17:00"), { amendsBookingId: rejected.id }));
  });

  it("59-S3 a suggestion can be accepted once", async () => {
    const event = await fixtures.event();
    const rejected = await repo.insert(booking(event, await fixtures.venue(), period("2030-11-14", "09:00", "17:00")));
    await db.from("venue_bookings").update({ status: "rejected" }).eq("id", rejected.id);

    const accepted = await repo.insert(
      booking(event, await fixtures.venue(), period("2030-11-15", "09:00", "17:00"), {
        amendsBookingId: rejected.id,
        fromSuggestion: true,
      }),
    );
    await db.from("venue_bookings").update({ status: "rejected" }).eq("id", accepted.id);

    await expect(
      repo.insert(
        booking(event, await fixtures.venue(), period("2030-11-16", "09:00", "17:00"), {
          amendsBookingId: rejected.id,
          fromSuggestion: true,
        }),
      ),
    ).rejects.toMatchObject({ code: "SUGGESTION_ALREADY_USED" });
  });
});
