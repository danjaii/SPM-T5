import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseVenueTimingWriter } from "../../src/readers/venueTimingWriter";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";

interface Reply {
  data?: unknown;
  error?: { code?: string; message: string } | null;
}

/** from().update().eq().eq().select().maybeSingle() for transitionFromPending. */
function updateDb(reply: Reply) {
  const chain: Record<string, unknown> = {};
  for (const m of ["update", "eq", "select"]) chain[m] = () => chain;
  chain.maybeSingle = async () => reply;
  return { from: () => chain } as unknown as SupabaseClient;
}

/** from().select().in().is().order().order() for flagsFor. */
function flagsDb(reply: Reply) {
  const calls: { in?: [string, string[]]; is?: [string, unknown]; table?: string } = {};
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.in = (col: string, ids: string[]) => ((calls.in = [col, ids]), chain);
  chain.is = (col: string, v: unknown) => ((calls.is = [col, v]), chain);
  chain.order = () => chain;
  chain.then = (resolve: (r: Reply) => unknown) => resolve(reply);
  return { db: { from: (t: string) => ((calls.table = t), chain) } as unknown as SupabaseClient, calls };
}

describe("SCRUM-104/AC4 a trigger refusal on approve is BOOKING_FLAGGED, not a 500 (104-S9)", () => {
  it("104-S9: CS104 from the approve guard becomes a 409 BOOKING_FLAGGED with the standard message", async () => {
    const repo = new SupabaseBookingRepository(updateDb({ data: null, error: { code: "CS104", message: "This request is flagged and cannot be approved." } }));

    await expect(repo.decide("b1", { outcome: "approved" }, "staff", new Date())).rejects.toMatchObject({
      code: "BOOKING_FLAGGED",
      httpStatus: 409,
      message: "This request is flagged and cannot be approved until the conflict is resolved. You can still reject it.",
    });
  });

  it("104-S9: a row-level refusal (42501) on a withdraw is a 403, and an unknown error stays a generic failure", async () => {
    await expect(new SupabaseBookingRepository(updateDb({ error: { code: "42501", message: "denied" } })).withdraw("b1", "u", new Date())).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
    await expect(new SupabaseBookingRepository(updateDb({ error: { code: "XX000", message: "secret" } })).withdraw("b1", "u", new Date())).rejects.toThrow(
      "Could not update the venue booking request.",
    );
  });
});

describe("SCRUM-104/AC3 flagsFor reads the open flags as the caller (104-S3)", () => {
  it("104-S3: asks for the open flags of these bookings and maps the rows, without any event name", async () => {
    const { db, calls } = flagsDb({
      data: [
        {
          id: "f1",
          booking_id: "b1",
          kind: "buffer_conflict",
          other_booking_id: "b2",
          other_start: "2030-11-14T02:00:00.000Z",
          other_end: "2030-11-14T04:00:00.000Z",
          created_at: "2030-10-01T00:00:00.000Z",
        },
      ],
      error: null,
    });

    const flags = await new SupabaseBookingRepository(db).flagsFor(["b1", "b3"]);

    expect(calls).toMatchObject({ table: "venue_booking_flags", in: ["booking_id", ["b1", "b3"]], is: ["resolved_at", null] });
    expect(flags).toEqual([
      {
        id: "f1",
        bookingId: "b1",
        kind: "buffer_conflict",
        otherBookingId: "b2",
        otherStart: new Date("2030-11-14T02:00:00.000Z"),
        otherEnd: new Date("2030-11-14T04:00:00.000Z"),
        unavailabilityId: null,
        unavailabilityReason: null,
        createdAt: new Date("2030-10-01T00:00:00.000Z"),
      },
    ]);
  });

  it("104-S3: no ids means no query, and a database error is a generic failure", async () => {
    const { db, calls } = flagsDb({ data: [], error: null });
    expect(await new SupabaseBookingRepository(db).flagsFor([])).toEqual([]);
    expect(calls.table).toBeUndefined();
    await expect(new SupabaseBookingRepository(flagsDb({ error: { message: "secret" } }).db).flagsFor(["b1"])).rejects.toThrow(
      "Could not read the venue booking flags.",
    );
  });

  it("106-S1: a venue_unavailable flag carries the block's id, period and reason (read through the block)", async () => {
    const { db } = flagsDb({
      data: [
        {
          id: "f3",
          booking_id: "b1",
          kind: "venue_unavailable",
          other_booking_id: null,
          other_start: "2030-11-14T00:00:00.000Z",
          other_end: "2030-11-16T10:00:00.000Z",
          unavailability_id: "u1",
          unavailability: { reason: "maintenance" },
          created_at: "2030-10-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    expect(await new SupabaseBookingRepository(db).flagsFor(["b1"])).toMatchObject([
      { kind: "venue_unavailable", otherBookingId: null, unavailabilityId: "u1", unavailabilityReason: "maintenance", otherStart: new Date("2030-11-14T00:00:00.000Z") },
    ]);
  });

  it("104-S3: a flag about a maintenance block (SCRUM-106) has no other booking and no period", async () => {
    const { db } = flagsDb({
      data: [{ id: "f2", booking_id: "b1", kind: "venue_unavailable", other_booking_id: null, other_start: null, other_end: null, created_at: "2030-10-01T00:00:00.000Z" }],
      error: null,
    });
    expect(await new SupabaseBookingRepository(db).flagsFor(["b1"])).toMatchObject([{ kind: "venue_unavailable", otherBookingId: null, otherStart: null, otherEnd: null }]);
  });
});

describe("SCRUM-104/AC1 SupabaseVenueTimingWriter returns the affected pairs (104-S1)", () => {
  const pairRow = {
    booking_id: "a",
    event_name: "Summit A",
    event_start: "2030-11-14T02:00:00.000Z",
    event_end: "2030-11-14T04:00:00.000Z",
    occupied_until: "2030-11-14T04:45:00.000Z",
    other_booking_id: "b",
    other_event_name: "Summit B",
    other_event_start: "2030-11-14T04:30:00.000Z",
    other_event_end: "2030-11-14T06:00:00.000Z",
    other_occupied_from: "2030-11-14T04:00:00.000Z",
  };

  it("104-S1: maps the rows of set_venue_timing to pairs, the earlier booking first", async () => {
    const rpc = vi.fn(async () => ({ data: [pairRow], error: null }));

    const pairs = await new SupabaseVenueTimingWriter({ rpc } as unknown as SupabaseClient).set("v1", 30, 45);

    expect(pairs).toEqual([
      {
        first: { bookingId: "a", eventName: "Summit A", eventStart: new Date("2030-11-14T02:00:00.000Z"), eventEnd: new Date("2030-11-14T04:00:00.000Z"), occupiedUntil: new Date("2030-11-14T04:45:00.000Z") },
        second: { bookingId: "b", eventName: "Summit B", eventStart: new Date("2030-11-14T04:30:00.000Z"), eventEnd: new Date("2030-11-14T06:00:00.000Z"), occupiedFrom: new Date("2030-11-14T04:00:00.000Z") },
      },
    ]);
  });

  it("104-S6: no rows (or null) means no pairs", async () => {
    for (const data of [[], null]) {
      const rpc = vi.fn(async () => ({ data, error: null }));
      expect(await new SupabaseVenueTimingWriter({ rpc } as unknown as SupabaseClient).set("v1", 0, 0)).toEqual([]);
    }
  });

  it("104-S9: a deadlock victim (40P01) is run again; any other error is not", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: "40P01", message: "deadlock detected" } })
      .mockResolvedValueOnce({ data: [pairRow], error: null });
    const pairs = await new SupabaseVenueTimingWriter({ rpc } as unknown as SupabaseClient).set("v1", 30, 45);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(pairs).toHaveLength(1);

    const failing = vi.fn(async () => ({ data: null, error: { code: "42501", message: "not allowed" } }));
    await expect(new SupabaseVenueTimingWriter({ rpc: failing } as unknown as SupabaseClient).set("v1", 1, 1)).rejects.toThrow(/not allowed/);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("104-S9: gives up after three deadlocks", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "40P01", message: "deadlock detected" } }));
    await expect(new SupabaseVenueTimingWriter({ rpc } as unknown as SupabaseClient).set("v1", 1, 1)).rejects.toThrow(/deadlock/);
    expect(rpc).toHaveBeenCalledTimes(3);
  });
});
