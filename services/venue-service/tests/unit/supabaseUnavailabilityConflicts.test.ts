import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";

describe("SCRUM-105/AC4 SupabaseBookingRepository unavailability lookups (105-S4, 105-S8)", () => {
  const row = { start_datetime: "2026-11-14T00:00:00.000Z", end_datetime: "2026-11-16T10:00:00.000Z", reason: "maintenance", venue_name: "Orchid Hall" };
  const start = new Date("2026-11-15T01:00:00.000Z");
  const end = new Date("2026-11-15T09:00:00.000Z");
  const rpcDb = (reply: { data: unknown; error: unknown }) => {
    const calls: unknown[][] = [];
    const db = { rpc: async (...args: unknown[]) => (calls.push(args), reply) } as unknown as SupabaseClient;
    return { repo: new SupabaseBookingRepository(db), calls };
  };

  it("105-S8: asks venue_unavailability_conflicts and maps the period, the reason and the venue's name", async () => {
    const { repo, calls } = rpcDb({ data: [row], error: null });

    expect(await repo.unavailabilityConflicts("v", start, end)).toEqual([
      { start: new Date(row.start_datetime), end: new Date(row.end_datetime), reason: "maintenance", venueName: "Orchid Hall" },
    ]);
    expect(calls[0]).toEqual(["venue_unavailability_conflicts", { p_venue_id: "v", p_start: start.toISOString(), p_end: end.toISOString() }]);
  });

  it("105-S8: no rows is an empty list, and a database error is a plain Error that leaks nothing", async () => {
    expect(await rpcDb({ data: null, error: null }).repo.unavailabilityConflicts("v", start, end)).toEqual([]);
    const failed = rpcDb({ data: null, error: { code: "42501", message: "raw database message" } }).repo.unavailabilityConflicts("v", start, end);
    await expect(failed).rejects.toThrow("Could not check the venue's availability.");
  });

  it("105-S4: the trigger's CS105 becomes VENUE_UNAVAILABLE (409) when a booking is inserted or changed", async () => {
    const { repo } = rpcDb({ data: null, error: { code: "CS105", message: "raw database message" } });
    const aChange = { start, end, expectedAttendance: 10, venueRequirements: null };

    await expect(repo.change("booking-1", aChange, new Date())).rejects.toMatchObject({ code: "VENUE_UNAVAILABLE", httpStatus: 409 });

    const db = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: "CS105", message: "raw" } }) }) }) }) } as unknown as SupabaseClient;
    const insert = new SupabaseBookingRepository(db).insert({
      eventId: "e",
      venueId: "v",
      start,
      end,
      requestedBy: "u",
      snapshot: { eventName: "E", expectedAttendance: 1, venueRequirements: null, accessibilityNeeds: null },
    });
    await expect(insert).rejects.toMatchObject({ code: "VENUE_UNAVAILABLE", httpStatus: 409 });
  });
});
