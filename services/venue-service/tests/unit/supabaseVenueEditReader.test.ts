import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SupabaseVenueEditReader } from "../../src/readers/venueEditReader";

// A tiny stand-in for the PostgREST query builder: records what was asked and answers with the rows it was given.
function clientWith(tables: Record<string, unknown[] | null>) {
  const asked: { table: string; eq: [string, unknown][]; in: [string, unknown[]][] }[] = [];
  const client = {
    from: (table: string) => {
      const call = { table, eq: [] as [string, unknown][], in: [] as [string, unknown[]][] };
      asked.push(call);
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => { call.eq.push([col, val]); return builder; },
        in: (col: string, vals: unknown[]) => { call.in.push([col, vals]); return builder; },
        maybeSingle: async () => ({ data: tables[table]?.[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve, reject),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, asked };
}

describe("SCRUM-58/AC1 the venue as the edit form needs it (58-S1)", () => {
  it("58-S1: maps the venue row, its layouts and its facilities to the form's values, with ids", async () => {
    const { client, asked } = clientWith({
      venues: [
        {
          id: "orchid",
          name: "Orchid Hall",
          address: "Level 3",
          description: null,
          max_capacity: 150,
          operating_hours_start: "08:00:00",
          operating_hours_end: "22:00:00",
          is_accessible: true,
          accessibility_notes: "Step-free entrance.",
          venue_supported_layouts: [{ room_layout_id: "layout-1", max_capacity_for_layout: 120 }],
          venue_facilities: [{ facility_id: "facility-1" }, { facility_id: "facility-2" }],
        },
      ],
    });

    const venue = await new SupabaseVenueEditReader(client).forEdit("orchid");

    expect(venue).toEqual({
      name: "Orchid Hall",
      address: "Level 3",
      description: null,
      maxCapacity: 150,
      operatingHoursStart: "08:00",
      operatingHoursEnd: "22:00",
      isAccessible: true,
      accessibilityNotes: "Step-free entrance.",
      layouts: [{ layoutId: "layout-1", maxCapacity: 120 }],
      facilityIds: ["facility-1", "facility-2"],
    });
    expect(asked[0]).toMatchObject({ table: "venues", eq: [["id", "orchid"]] });
  });

  it("58-S1: a venue with no hours, layouts or facilities still maps", async () => {
    const { client } = clientWith({
      venues: [{ id: "v", name: "Bare", address: "A", description: "d", max_capacity: 10, operating_hours_start: null, operating_hours_end: null, is_accessible: false, accessibility_notes: null, venue_supported_layouts: null, venue_facilities: null }],
    });

    expect(await new SupabaseVenueEditReader(client).forEdit("v")).toMatchObject({ operatingHoursStart: null, operatingHoursEnd: null, layouts: [], facilityIds: [] });
  });

  it("58-S3: an unknown venue is null", async () => {
    const { client } = clientWith({ venues: [] });
    expect(await new SupabaseVenueEditReader(client).forEdit("nope")).toBeNull();
  });
});

describe("SCRUM-58/AC4 the bookings a capacity cut is checked against (58-S4)", () => {
  it("58-S4: asks for the venue's holding bookings and maps their own attendance", async () => {
    const { client, asked } = clientWith({
      venue_bookings: [
        { id: "b1", status: "approved", event_start_datetime: "2026-11-10T01:00:00+00:00", event_end_datetime: "2026-11-10T09:00:00+00:00", snapshot_event_name: "Annual Tech Summit", snapshot_expected_attendance: 120 },
        { id: "b2", status: "requested", event_start_datetime: "2026-11-11T01:00:00+00:00", event_end_datetime: "2026-11-11T09:00:00+00:00", snapshot_event_name: null, snapshot_expected_attendance: null },
      ],
    });

    const bookings = await new SupabaseVenueEditReader(client).bookings("orchid");

    expect(bookings).toEqual([
      { bookingId: "b1", eventName: "Annual Tech Summit", eventStart: "2026-11-10T01:00:00+00:00", eventEnd: "2026-11-10T09:00:00+00:00", expectedAttendance: 120, status: "approved" },
      { bookingId: "b2", eventName: "", eventStart: "2026-11-11T01:00:00+00:00", eventEnd: "2026-11-11T09:00:00+00:00", expectedAttendance: null, status: "requested" },
    ]);
    expect(asked[0]).toMatchObject({ table: "venue_bookings", eq: [["venue_id", "orchid"]], in: [["status", ["requested", "tentative", "approved", "confirmed"]]] });
  });
});
