import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseVenueCalendarReader } from "../../src/readers/venueCalendarReader";

type Reply = { data: unknown; error: { message: string } | null };

/** Records the rpc call, and every chained query method returns the chain; awaiting it gives the reply. */
function stubDb(reply: Reply) {
  const calls: { fn: string; args: unknown }[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order"]) chain[m] = () => chain;
  chain.then = (resolve: (r: Reply) => unknown) => resolve(reply);
  const db = {
    from: () => chain,
    rpc: async (fn: string, args: unknown) => (calls.push({ fn, args }), reply),
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("SCRUM-84/AC2 SupabaseVenueCalendarReader", () => {
  it("reads bookings and blocks with one venue_calendar_entries call and maps Pending to Tentatively Held, Approved (and legacy rows) to Confirmed", async () => {
    const booking = (status: string) => ({
      entry: "booking", venue_id: "v1", status, starts_at: "2026-11-14T02:00:00Z", ends_at: "2026-11-14T04:00:00Z",
      occupied_start: "2026-11-14T01:30:00Z", occupied_end: "2026-11-14T04:45:00Z", setup_minutes: 30, turnaround_minutes: 45, reason: null,
    });
    const block = { entry: "block", venue_id: "v1", status: null, starts_at: "2026-11-15T02:00:00Z", ends_at: "2026-11-15T04:00:00Z", reason: "renovation" };
    const { db, calls } = stubDb({ data: [booking("requested"), booking("approved"), booking("confirmed"), booking("tentative"), block], error: null });
    const from = new Date("2026-11-13T16:00:00Z");
    const to = new Date("2026-11-20T16:00:00Z");

    const { bookings, blocks } = await new SupabaseVenueCalendarReader(db).entries(from, to);

    expect(calls).toEqual([{ fn: "venue_calendar_entries", args: { p_from: from.toISOString(), p_to: to.toISOString() } }]);
    expect(bookings.map((b) => b.status)).toEqual(["TENTATIVELY_HELD", "CONFIRMED", "CONFIRMED", "CONFIRMED"]);
    expect(bookings[0]).toEqual({
      venueId: "v1", status: "TENTATIVELY_HELD", eventStart: new Date("2026-11-14T02:00:00Z"), eventEnd: new Date("2026-11-14T04:00:00Z"),
      occupiedStart: new Date("2026-11-14T01:30:00Z"), occupiedEnd: new Date("2026-11-14T04:45:00Z"), setupMinutes: 30, turnaroundMinutes: 45,
    });
    expect(blocks).toEqual([{ venueId: "v1", start: new Date("2026-11-15T02:00:00Z"), end: new Date("2026-11-15T04:00:00Z"), reason: "renovation" }]);
  });

  it("reads nothing when the database returns no rows, and throws on an error", async () => {
    expect(await new SupabaseVenueCalendarReader(stubDb({ data: null, error: null }).db).entries(new Date(), new Date())).toEqual({ bookings: [], blocks: [] });
    await expect(new SupabaseVenueCalendarReader(stubDb({ data: null, error: { message: "down" } }).db).entries(new Date(), new Date())).rejects.toThrow(/venue calendar/);
  });

  it("lists the active venues with hours as HH:MM, 0 for missing setup times, and throws on an error", async () => {
    const row = { id: "v1", name: "Orchid Hall", address: "x", max_capacity: 150, operating_hours_start: "08:00:00", operating_hours_end: "22:30:00", setup_minutes: null, turnaround_minutes: 45 };
    const noTimes = { ...row, id: "v2", turnaround_minutes: null };
    const venues = await new SupabaseVenueCalendarReader(stubDb({ data: [row, { ...row, operating_hours_start: null, operating_hours_end: null }, noTimes], error: null }).db).venueList();
    expect(venues[0]).toEqual({ id: "v1", name: "Orchid Hall", address: "x", maxCapacity: 150, operatingStart: "08:00", operatingEnd: "22:30", setupMinutes: 0, turnaroundMinutes: 45 });
    expect(venues[1]).toMatchObject({ operatingStart: null, operatingEnd: null });
    expect(venues[2]).toMatchObject({ setupMinutes: 0, turnaroundMinutes: 0 });
    expect(await new SupabaseVenueCalendarReader(stubDb({ data: null, error: null }).db).venueList()).toEqual([]);
    await expect(new SupabaseVenueCalendarReader(stubDb({ data: null, error: { message: "down" } }).db).venueList()).rejects.toThrow(/venues/);
  });
});
