import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseBookingRepository } from "../../src/repositories/supabaseBookingRepository";

describe("SCRUM-103/AC1 SupabaseBookingRepository padded lookups (103-S1, 103-S5)", () => {
  const row = {
    event_start: "2026-11-14T02:00:00.000Z",
    event_end: "2026-11-14T04:00:00.000Z",
    occupied_start: "2026-11-14T01:30:00.000Z",
    occupied_end: "2026-11-14T04:45:00.000Z",
    status: "approved",
    venue_name: "Orchid Hall",
    setup_minutes: 30,
    turnaround_minutes: 45,
  };
  const rpcDb = (reply: { data: unknown; error: unknown }) => {
    const calls: unknown[][] = [];
    const db = { rpc: async (...args: unknown[]) => (calls.push(args), reply) } as unknown as SupabaseClient;
    return { repo: new SupabaseBookingRepository(db), calls };
  };
  const start = new Date("2026-11-14T04:30:00.000Z");
  const end = new Date("2026-11-14T06:00:00.000Z");

  it("103-S1: slotConflicts asks venue_slot_conflicts and maps the periods", async () => {
    const { repo, calls } = rpcDb({ data: [row], error: null });
    expect(await repo.slotConflicts("v", start, end)).toEqual([
      {
        eventStart: new Date(row.event_start),
        eventEnd: new Date(row.event_end),
        occupiedStart: new Date(row.occupied_start),
        occupiedEnd: new Date(row.occupied_end),
        status: "APPROVED",
        venueName: "Orchid Hall",
        timing: { setupMinutes: 30, turnaroundMinutes: 45 },
      },
    ]);
    expect(calls[0]).toEqual(["venue_slot_conflicts", { p_venue_id: "v", p_start: start.toISOString(), p_end: end.toISOString(), p_exclude_booking_id: null }]);
  });

  it("103-S4: a requested row is PENDING; no rows is an empty list", async () => {
    const pending = await rpcDb({ data: [{ ...row, status: "requested" }], error: null }).repo.slotConflicts("v", start, end);
    expect(pending[0].status).toBe("PENDING");
    expect(await rpcDb({ data: null, error: null }).repo.slotConflicts("v", start, end)).toEqual([]);
  });

  it("103-S5: occupiedPeriods asks venue_occupied_periods", async () => {
    const { repo, calls } = rpcDb({ data: [row], error: null });
    expect(await repo.occupiedPeriods("v", start, end)).toHaveLength(1);
    expect(calls[0]).toEqual(["venue_occupied_periods", { p_venue_id: "v", p_from: start.toISOString(), p_to: end.toISOString() }]);
  });

  it("103-S1: a failed lookup is a generic error that leaks nothing", async () => {
    const { repo } = rpcDb({ data: null, error: { code: "XX000", message: "secret" } });
    await expect(repo.slotConflicts("v", start, end)).rejects.toThrow("Could not check the venue's availability.");
    await expect(repo.occupiedPeriods("v", start, end)).rejects.toThrow("Could not read the venue's availability.");
  });
});
