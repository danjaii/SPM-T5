import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { supabasePorts } from "../../src/ports";
import { SupabaseEquipmentReader } from "../../src/readers/equipmentReader";
import { SupabaseEquipmentRequestReader } from "../../src/readers/equipmentRequestReader";
import { SupabaseVenueBookingReader } from "../../src/readers/venueBookingReader";
import { SupabaseEquipmentRequestWriter } from "../../src/writers/equipmentRequestWriter";
import { SupabaseEventReader } from "../../src/readers/eventReader";
import { SupabaseReservationReader } from "../../src/readers/reservationReader";
import { SupabaseRoleReader } from "../../src/readers/roleReader";
import { createSupabaseDeps, type SupabaseDeps } from "../../src/supabase";
import { SupabaseReservationWriter } from "../../src/writers/reservationWriter";

// A pretend Supabase library: a real createClient opens a live connection, which needs WebSocket (Node 22+).
// CI's test job runs Node 20, so the real one would fail there. Nothing in this file needs a real connection.
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => ({})) }));

// ----------------------------------------------------------------------------
// Pretend Supabase: records every query it is asked (table, filters, order) and gives back a set reply.
// The other tests use fake readers; these check the real readers ask Supabase the right questions.
// ----------------------------------------------------------------------------

type Reply = { data: unknown; error: { message: string } | null };

function stubDb(reply: Reply) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lt", "gt", "order"]) {
    chain[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    };
  }
  chain.maybeSingle = async () => reply;
  chain.then = (resolve: (r: Reply) => unknown) => resolve(reply);
  const db = {
    from: (table: string) => {
      calls.push(["from", table]);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

// end of pretend Supabase

// ----------------------------------------------------------------------------
// SCRUM-18 Supabase readers
// ----------------------------------------------------------------------------
describe("SCRUM-18 Supabase readers", () => {
  // The equipment catalogue: read from the equipment table, A to Z, turned into the shape the service uses.
  it("SupabaseEquipmentReader lists the catalogue in name order and maps each row", async () => {
    const { db, calls } = stubDb({
      data: [{ id: "e1", name: "Projector Unit", type: "AV", total_quantity: 10, operational_status: "available" }],
      error: null,
    });

    expect(await new SupabaseEquipmentReader(db).list()).toEqual([
      { id: "e1", name: "Projector Unit", type: "AV", totalQuantity: 10, operationalStatus: "available" },
    ]);
    expect(calls).toContainEqual(["from", "equipment"]);
    expect(calls).toContainEqual(["order", "name", { ascending: true }]);
  });

  it("SupabaseEquipmentReader throws when Supabase fails", async () => {
    const { db } = stubDb({ data: null, error: { message: "down" } });

    await expect(new SupabaseEquipmentReader(db).list()).rejects.toThrow(/Reading equipment failed/);
  });
  // end of equipment reader

  // Reservations: only this equipment's, and only those that overlap the period being checked.
  it("SupabaseReservationReader asks for this equipment's reservations that overlap the period", async () => {
    const start = new Date("2026-10-15T01:00:00Z");
    const end = new Date("2026-10-15T09:00:00Z");
    const { db, calls } = stubDb({
      data: [
        {
          equipment_id: "e1",
          start_datetime: "2026-10-15T02:00:00+00:00",
          end_datetime: "2026-10-15T05:00:00+00:00",
          status: "approved",
          quantity_requested: 4,
          quantity_reserved: null,
        },
      ],
      error: null,
    });

    expect(await new SupabaseReservationReader(db).overlapping("e1", start, end)).toEqual([
      {
        equipmentId: "e1",
        start: new Date("2026-10-15T02:00:00Z"),
        end: new Date("2026-10-15T05:00:00Z"),
        status: "approved",
        quantityRequested: 4,
        quantityReserved: null,
      },
    ]);
    expect(calls).toContainEqual(["from", "equipment_reservations"]);
    expect(calls).toContainEqual(["eq", "equipment_id", "e1"]);
    // Overlap: the reservation starts before the period ends, and ends after the period starts.
    expect(calls).toContainEqual(["lt", "start_datetime", end.toISOString()]);
    expect(calls).toContainEqual(["gt", "end_datetime", start.toISOString()]);
  });

  it("SupabaseReservationReader throws when Supabase fails", async () => {
    const { db } = stubDb({ data: null, error: { message: "down" } });

    await expect(
      new SupabaseReservationReader(db).overlapping("e1", new Date(), new Date()),
    ).rejects.toThrow(/Reading equipment reservations failed/);
  });
  // end of reservation reader

  // Roles: a real role comes back as it is; anything else counts as no role.
  it("SupabaseRoleReader returns a real role, and undefined for anything else", async () => {
    const role = (data: unknown) => new SupabaseRoleReader(stubDb({ data, error: null }).db).roleOf("u");

    expect(await role({ role: "technical_support_staff" })).toBe("technical_support_staff");
    expect(await role({ role: "wizard" })).toBeUndefined();
    expect(await role(null)).toBeUndefined();
  });
  // end of role reader

  // Wiring: every reader queries as the signed-in user (so Supabase's access rules apply).
  it("supabasePorts builds every reader on the caller's own connection", () => {
    const tokens: string[] = [];
    const deps = {
      anon: {} as SupabaseClient,
      forUser: (token: string) => {
        tokens.push(token);
        return stubDb({ data: null, error: null }).db;
      },
    } satisfies SupabaseDeps;

    const ports = supabasePorts(deps)("tok-1");

    expect(tokens).toEqual(["tok-1"]);
    expect(ports.equipment).toBeInstanceOf(SupabaseEquipmentReader);
    expect(ports.reservations).toBeInstanceOf(SupabaseReservationReader);
    expect(ports.roles).toBeInstanceOf(SupabaseRoleReader);
    // SCRUM-19: the event reader and the reservation writer too.
    expect(ports.events).toBeInstanceOf(SupabaseEventReader);
    expect(ports.writer).toBeInstanceOf(SupabaseReservationWriter);
    // SCRUM-86: the venue booking and equipment request readers, and the request writer.
    expect(ports.venueBookings).toBeInstanceOf(SupabaseVenueBookingReader);
    expect(ports.requests).toBeInstanceOf(SupabaseEquipmentRequestReader);
    expect(ports.requestWriter).toBeInstanceOf(SupabaseEquipmentRequestWriter);
  });

  it("createSupabaseDeps refuses to start without the Supabase settings, and connects when they are set", () => {
    expect(() => createSupabaseDeps({})).toThrow(/SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set/);

    createSupabaseDeps({ SUPABASE_URL: "http://localhost:54321", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" }).forUser("tok-1");

    // createClient is the pretend one from vi.mock above, so no real connection (and no WebSocket) is needed.
    expect(vi.mocked(createClient)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(createClient).mock.calls[0].slice(0, 2)).toEqual(["http://localhost:54321", "sb_publishable_x"]);
    // The second connection carries the user's login token, so queries run as that user.
    expect(vi.mocked(createClient).mock.calls[1][2]).toMatchObject({
      global: { headers: { Authorization: "Bearer tok-1" } },
    });
  });
  // end of wiring
});
// end of SCRUM-18 Supabase readers

// ----------------------------------------------------------------------------
// SCRUM-19 Supabase event reader: the events a reservation can be made for.
// ----------------------------------------------------------------------------
describe("SCRUM-19 Supabase event reader", () => {
  // A row as Supabase gives it back: the coordinator's name arrives nested, under "coordinator".
  const row = {
    id: "evt-1",
    name: "DevOps Summit",
    status: "approved",
    preferred_start_datetime: "2026-10-15T01:00:00+00:00",
    preferred_end_datetime: "2026-10-15T09:00:00+00:00",
    assigned_coordinator_id: "coord-1",
    coordinator: { full_name: "Dana Lim" },
  };

  it("SupabaseEventReader lists events from the events table, mapping each row", async () => {
    // The second event has no dates and no coordinator yet.
    const { db, calls } = stubDb({
      data: [
        row,
        { ...row, id: "evt-2", preferred_start_datetime: null, preferred_end_datetime: null, assigned_coordinator_id: null, coordinator: null },
      ],
      error: null,
    });

    expect(await new SupabaseEventReader(db).list()).toEqual([
      {
        id: "evt-1",
        name: "DevOps Summit",
        status: "approved",
        start: new Date("2026-10-15T01:00:00Z"),
        end: new Date("2026-10-15T09:00:00Z"),
        coordinatorName: "Dana Lim",
        // SCRUM-86/AC7: who is assigned, so the service can check it is the caller.
        assignedCoordinatorId: "coord-1",
      },
      { id: "evt-2", name: "DevOps Summit", status: "approved", start: null, end: null, coordinatorName: null, assignedCoordinatorId: null },
    ]);
    expect(calls).toContainEqual(["from", "events"]);
  });

  it("SupabaseEventReader finds one event by its id, or undefined when there is none", async () => {
    const found = stubDb({ data: row, error: null });

    expect((await new SupabaseEventReader(found.db).find("evt-1"))?.name).toBe("DevOps Summit");
    expect(found.calls).toContainEqual(["eq", "id", "evt-1"]);
    expect(await new SupabaseEventReader(stubDb({ data: null, error: null }).db).find("nope")).toBeUndefined();
  });

  it("SupabaseEventReader throws when Supabase fails", async () => {
    const { db } = stubDb({ data: null, error: { message: "down" } });

    await expect(new SupabaseEventReader(db).list()).rejects.toThrow(/Reading events failed/);
    await expect(new SupabaseEventReader(db).find("evt-1")).rejects.toThrow(/Reading the event failed/);
  });
});
// end of SCRUM-19 Supabase event reader

// ----------------------------------------------------------------------------
// SCRUM-86 Supabase readers and writer: the event's venue bookings, its equipment requests, and saving one.
// Migration 25's insert policy is tested against a real database (tests/integration/equipmentRequests.test.ts).
// ----------------------------------------------------------------------------
describe("SCRUM-86 Supabase readers and writer", () => {
  it("SupabaseVenueBookingReader asks for the event's bookings with the booked venue's name", async () => {
    const { db, calls } = stubDb({
      data: [
        {
          id: "vb-1",
          event_id: "evt-1",
          status: "approved",
          event_start_datetime: "2026-10-15T01:00:00+00:00",
          event_end_datetime: "2026-10-15T09:00:00+00:00",
          venue: { name: "Grand Hall" },
        },
        { id: "vb-2", event_id: "evt-1", status: "requested", event_start_datetime: "2026-10-16T01:00:00+00:00", event_end_datetime: "2026-10-16T09:00:00+00:00", venue: null },
      ],
      error: null,
    });

    expect(await new SupabaseVenueBookingReader(db).forEvent("evt-1")).toEqual([
      { id: "vb-1", eventId: "evt-1", venueName: "Grand Hall", status: "approved", start: new Date("2026-10-15T01:00:00Z"), end: new Date("2026-10-15T09:00:00Z") },
      { id: "vb-2", eventId: "evt-1", venueName: "Unknown venue", status: "requested", start: new Date("2026-10-16T01:00:00Z"), end: new Date("2026-10-16T09:00:00Z") },
    ]);
    expect(calls).toContainEqual(["from", "venue_bookings"]);
    expect(calls).toContainEqual(["eq", "event_id", "evt-1"]);
    // venue_bookings has two links to venues (the booked one and a suggested one): ask for the booked one.
    expect(calls.find((c) => c[0] === "select")?.[1]).toContain("venues!venue_bookings_venue_id_fkey(name)");
  });

  it("SupabaseEquipmentRequestReader asks for the event's equipment_reservations rows with item and venue", async () => {
    const { db, calls } = stubDb({
      data: [
        {
          id: "req-1",
          event_id: "evt-1",
          quantity_requested: 2,
          notes: "On stage",
          status: "requested",
          created_at: "2026-10-01T01:00:00+00:00",
          equipment: { name: "Wireless Microphone Set", type: "Audio" },
          booking: { venue: { name: "Grand Hall" } },
        },
        // A row from before requests named a venue, for an item with no type.
        { id: "res-1", event_id: "evt-1", quantity_requested: 1, notes: null, status: "reserved", created_at: "2026-09-01T01:00:00+00:00", equipment: { name: "Cable", type: null }, booking: null },
      ],
      error: null,
    });

    expect(await new SupabaseEquipmentRequestReader(db).forEvent("evt-1")).toEqual([
      { id: "req-1", eventId: "evt-1", equipmentName: "Wireless Microphone Set", equipmentType: "Audio", quantity: 2, venueName: "Grand Hall", notes: "On stage", status: "requested", createdAt: new Date("2026-10-01T01:00:00Z") },
      { id: "res-1", eventId: "evt-1", equipmentName: "Cable", equipmentType: null, quantity: 1, venueName: null, notes: null, status: "reserved", createdAt: new Date("2026-09-01T01:00:00Z") },
    ]);
    expect(calls).toContainEqual(["from", "equipment_reservations"]);
    expect(calls).toContainEqual(["eq", "event_id", "evt-1"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: true }]);
  });

  it("SupabaseEquipmentRequestReader names a missing item rather than failing", async () => {
    const { db } = stubDb({
      data: [{ id: "r", event_id: "e", quantity_requested: 1, notes: null, status: "requested", created_at: "2026-10-01T00:00:00Z", equipment: null, booking: null }],
      error: null,
    });
    expect((await new SupabaseEquipmentRequestReader(db).forEvent("e"))[0]).toMatchObject({ equipmentName: "Unknown equipment", equipmentType: null });
  });

  it("the SCRUM-86 readers throw when Supabase fails", async () => {
    const { db } = stubDb({ data: null, error: { message: "down" } });
    await expect(new SupabaseVenueBookingReader(db).forEvent("e")).rejects.toThrow(/Reading venue bookings failed/);
    await expect(new SupabaseEquipmentRequestReader(db).forEvent("e")).rejects.toThrow(/Reading equipment requests failed/);
  });

  /** A pretend Supabase for the writer: records the row it is asked to insert and gives back a set reply. */
  function insertDb(reply: Reply) {
    const inserted: Array<{ table: string; row: unknown }> = [];
    const db = {
      from: (table: string) => ({
        insert: (row: unknown) => {
          inserted.push({ table, row });
          return { select: () => ({ single: async () => reply }) };
        },
      }),
    } as unknown as SupabaseClient;
    return { db, inserted };
  }

  const newRequest = {
    eventId: "evt-1",
    equipmentId: "eq-mic",
    quantity: 4,
    venueBookingId: "vb-1",
    notes: "On stage",
    start: new Date("2026-10-15T01:00:00Z"),
    end: new Date("2026-10-15T09:00:00Z"),
    requestedBy: "coord-1",
  };

  it("SupabaseEquipmentRequestWriter inserts a Submitted ('requested') row in the coordinator's name", async () => {
    const { db, inserted } = insertDb({ data: { id: "req-9" }, error: null });

    expect(await new SupabaseEquipmentRequestWriter(db).create(newRequest)).toEqual({ id: "req-9" });
    expect(inserted).toEqual([
      {
        table: "equipment_reservations",
        row: {
          event_id: "evt-1",
          equipment_id: "eq-mic",
          quantity_requested: 4,
          venue_booking_id: "vb-1",
          notes: "On stage",
          start_datetime: "2026-10-15T01:00:00.000Z",
          end_datetime: "2026-10-15T09:00:00.000Z",
          status: "requested",
          requested_by: "coord-1",
        },
      },
    ]);
  });

  it("SupabaseEquipmentRequestWriter throws when Supabase refuses (e.g. the insert policy)", async () => {
    const { db } = insertDb({ data: null, error: { message: "new row violates row-level security policy" } });
    await expect(new SupabaseEquipmentRequestWriter(db).create(newRequest)).rejects.toThrow(/Saving the equipment request failed/);
  });
});
// end of SCRUM-86 Supabase readers and writer
