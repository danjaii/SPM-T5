import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { supabasePorts } from "../../src/ports";
import { SupabaseEquipmentReader } from "../../src/readers/equipmentReader";
import { SupabaseEquipmentRequestReader } from "../../src/readers/equipmentRequestReader";
import { SupabaseVenueBookingReader } from "../../src/readers/venueBookingReader";
import { SupabaseEquipmentRequestReviewer, SupabaseEquipmentRequestWriter } from "../../src/writers/equipmentRequestWriter";
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

type Reply = { data: unknown; error: { message: string; code?: string } | null };

function stubDb(reply: Reply) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "lt", "gt", "order"]) {
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
          event: { name: "Robotics Meetup" },
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
        eventName: "Robotics Meetup", // SCRUM-137: whose booking it is
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
    expect(ports.reviewer).toBeInstanceOf(SupabaseEquipmentRequestReviewer);
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
    organiser_id: "org-1",
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
        // SCRUM-153/AC5 (153-S11): who organises it, so the organiser can view the event's requests.
        organiserId: "org-1",
      },
      { id: "evt-2", name: "DevOps Summit", status: "approved", start: null, end: null, coordinatorName: null, assignedCoordinatorId: null, organiserId: "org-1" },
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
          equipment_id: "eq-mic",
          venue_booking_id: "vb-1",
          quantity_requested: 2,
          notes: "On stage",
          status: "requested",
          start_datetime: "2026-10-15T01:00:00+00:00",
          end_datetime: "2026-10-15T09:00:00+00:00",
          review_reason: null,
          // SCRUM-88/AC8: changed by the coordinator
          last_edited_at: "2026-10-15T09:40:00+00:00",
          editor: { full_name: "Rachel Tan" },
          created_at: "2026-10-01T01:00:00+00:00",
          // SCRUM-113: sent back for review after the event's attendance changed
          sent_back_changes: { expected_attendance: { from: 480, to: 600 } },
          sent_back_at: "2026-10-02T03:00:00+00:00",
          event: { name: "DevOps Summit", status: "approved", preferred_start_datetime: "2026-10-15T01:00:00+00:00" },
          equipment: { name: "Wireless Microphone Set", type: "Audio" },
          booking: { cancellation_reason: null, venue: { name: "Grand Hall" } },
        },
        // SCRUM-102 (102-S31): equipment released with its venue booking, which says why it was cancelled
        { id: "rel-1", event_id: "evt-1", equipment_id: "eq-cable", venue_booking_id: "vb-2", quantity_requested: 3, notes: null, status: "cancelled", start_datetime: "2026-10-15T01:00:00+00:00", end_datetime: "2026-10-15T09:00:00+00:00", review_reason: null, created_at: "2026-10-02T01:00:00+00:00", event: { name: "DevOps Summit", status: "approved", preferred_start_datetime: "2026-10-15T01:00:00+00:00" }, equipment: { name: "Cable", type: null }, booking: { cancellation_reason: "Moved to a bigger room", venue: { name: "Orchid Hall" } } },
        // A row from before requests named a venue, for an item with no type.
        { id: "res-1", event_id: "evt-1", equipment_id: "eq-cable", venue_booking_id: null, quantity_requested: 1, notes: null, status: "rejected", start_datetime: "2026-10-15T01:00:00+00:00", end_datetime: "2026-10-15T09:00:00+00:00", review_reason: "All out on loan", last_edited_at: "2026-10-14T01:00:00+00:00", editor: null, created_at: "2026-09-01T01:00:00+00:00", event: { name: "DevOps Summit", status: "approved", preferred_start_datetime: null }, equipment: { name: "Cable", type: null }, booking: null },
      ],
      error: null,
    });

    expect(await new SupabaseEquipmentRequestReader(db).forEvent("evt-1")).toEqual([
      { id: "req-1", eventId: "evt-1", eventName: "DevOps Summit", eventStatus: "approved", eventStart: new Date("2026-10-15T01:00:00Z"), equipmentId: "eq-mic", equipmentName: "Wireless Microphone Set", equipmentType: "Audio", quantity: 2, venueName: "Grand Hall", venueBookingId: "vb-1", notes: "On stage", status: "requested", start: new Date("2026-10-15T01:00:00Z"), end: new Date("2026-10-15T09:00:00Z"), reviewReason: null, venueBookingCancellationReason: null, lastChangedBy: "Rachel Tan", lastChangedAt: new Date("2026-10-15T09:40:00Z"), createdAt: new Date("2026-10-01T01:00:00Z"), sentBackChanges: { expected_attendance: { from: 480, to: 600 } }, sentBackAt: new Date("2026-10-02T03:00:00Z") },
      { id: "rel-1", eventId: "evt-1", eventName: "DevOps Summit", eventStatus: "approved", eventStart: new Date("2026-10-15T01:00:00Z"), equipmentId: "eq-cable", equipmentName: "Cable", equipmentType: null, quantity: 3, venueName: "Orchid Hall", venueBookingId: "vb-2", notes: null, status: "cancelled", start: new Date("2026-10-15T01:00:00Z"), end: new Date("2026-10-15T09:00:00Z"), reviewReason: null, venueBookingCancellationReason: "Moved to a bigger room", lastChangedBy: null, lastChangedAt: null, createdAt: new Date("2026-10-02T01:00:00Z"), sentBackChanges: null, sentBackAt: null },
      // SCRUM-87/AC5: a Cannot Fulfil row carries its reason; an event with no date has no eventStart.
      // SCRUM-88/AC8: a change by someone whose name cannot be read still says it was changed.
      { id: "res-1", eventId: "evt-1", eventName: "DevOps Summit", eventStatus: "approved", eventStart: null, equipmentId: "eq-cable", equipmentName: "Cable", equipmentType: null, quantity: 1, venueName: null, venueBookingId: null, notes: null, status: "rejected", start: new Date("2026-10-15T01:00:00Z"), end: new Date("2026-10-15T09:00:00Z"), reviewReason: "All out on loan", venueBookingCancellationReason: null, lastChangedBy: "Unknown user", lastChangedAt: new Date("2026-10-14T01:00:00Z"), createdAt: new Date("2026-09-01T01:00:00Z"), sentBackChanges: null, sentBackAt: null },
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

// ----------------------------------------------------------------------------
// SCRUM-87 Supabase reader queries and the reviewer
// ----------------------------------------------------------------------------
describe("SCRUM-87 Supabase reader and reviewer", () => {
  const row = {
    id: "req-1",
    event_id: "evt-1",
    quantity_requested: 2,
    notes: null,
    status: "under_review",
    start_datetime: "2026-10-15T01:00:00+00:00",
    end_datetime: "2026-10-15T09:00:00+00:00",
    review_reason: null,
    created_at: "2026-10-01T01:00:00+00:00",
    event: null,
    equipment: { name: "Projector Unit", type: "AV" },
    booking: null,
  };

  it("SCRUM-87/AC1 waiting() asks for the Submitted and Under Review rows", async () => {
    const { db, calls } = stubDb({ data: [row], error: null });
    const [request] = await new SupabaseEquipmentRequestReader(db).waiting();
    // A row whose event cannot be read is still named, rather than failing.
    expect(request).toMatchObject({ id: "req-1", eventName: "Unknown event", eventStatus: "", eventStart: null, status: "under_review" });
    expect(calls).toContainEqual(["in", "status", ["requested", "under_review"]]);
  });

  it("SCRUM-87/AC3 find() reads one row by id, and answers undefined when there is none", async () => {
    const found = stubDb({ data: row, error: null });
    expect(await new SupabaseEquipmentRequestReader(found.db).find("req-1")).toMatchObject({ id: "req-1" });
    expect(found.calls).toContainEqual(["eq", "id", "req-1"]);

    expect(await new SupabaseEquipmentRequestReader(stubDb({ data: null, error: null }).db).find("req-x")).toBeUndefined();
    // 22P02: not a uuid at all, so no such request (a 404, not a crash).
    const notUuid = stubDb({ data: null, error: { message: "invalid input syntax for type uuid", code: "22P02" } });
    expect(await new SupabaseEquipmentRequestReader(notUuid.db).find("abc")).toBeUndefined();
  });

  it("the SCRUM-87 reader queries throw when Supabase fails", async () => {
    const { db } = stubDb({ data: null, error: { message: "down" } });
    await expect(new SupabaseEquipmentRequestReader(db).waiting()).rejects.toThrow(/Reading equipment requests failed/);
    await expect(new SupabaseEquipmentRequestReader(db).find("req-1")).rejects.toThrow(/Reading the equipment request failed/);
  });

  /** A pretend Supabase for the reviewer: records the function call and gives back a set reply. */
  function rpcDb(reply: Reply) {
    const calls: Array<[string, unknown]> = [];
    const db = {
      rpc: async (fn: string, args: unknown) => {
        calls.push([fn, args]);
        return reply;
      },
    } as unknown as SupabaseClient;
    return { db, calls };
  }

  const review = { requestId: "req-1", dbStatus: "rejected", reason: "All out on loan" };

  it("SCRUM-87/AC4, AC5 SupabaseEquipmentRequestReviewer calls review_equipment_request() with the status and reason", async () => {
    const { db, calls } = rpcDb({ data: [{ outcome: "updated", available: null }], error: null });
    expect(await new SupabaseEquipmentRequestReviewer(db).review(review)).toEqual({ outcome: "updated" });
    expect(calls).toEqual([["review_equipment_request", { p_request_id: "req-1", p_status: "rejected", p_reason: "All out on loan" }]]);
  });

  it("SupabaseEquipmentRequestReviewer passes on how many were free when Arranged is refused", async () => {
    const { db } = rpcDb({ data: [{ outcome: "insufficient", available: 3 }], error: null });
    expect(await new SupabaseEquipmentRequestReviewer(db).review(review)).toEqual({ outcome: "insufficient", available: 3 });
    const none = rpcDb({ data: [{ outcome: "insufficient", available: null }], error: null });
    expect(await new SupabaseEquipmentRequestReviewer(none.db).review(review)).toEqual({ outcome: "insufficient", available: 0 });
  });

  it("SupabaseEquipmentRequestReviewer throws when the database refuses (e.g. not Technical Support Staff)", async () => {
    const { db } = rpcDb({ data: null, error: { message: "Only Technical Support Staff can review equipment requests" } });
    await expect(new SupabaseEquipmentRequestReviewer(db).review(review)).rejects.toThrow(/Reviewing the equipment request failed/);
  });

  const change = {
    requestId: "req-1",
    equipmentId: "eq-mic",
    quantity: 6,
    venueBookingId: "vb-annex",
    notes: "Two more on stage",
    start: new Date("2026-10-16T01:00:00Z"),
    end: new Date("2026-10-16T05:00:00Z"),
  };

  it("SCRUM-88/AC1, AC2 SupabaseEquipmentRequestWriter.update calls update_equipment_request() with the new details", async () => {
    const { db, calls } = rpcDb({ data: "updated", error: null });
    expect(await new SupabaseEquipmentRequestWriter(db).update(change)).toBe("updated");
    expect(calls).toEqual([
      [
        "update_equipment_request",
        {
          p_request_id: "req-1",
          p_equipment_id: "eq-mic",
          p_quantity: 6,
          p_venue_booking_id: "vb-annex",
          p_notes: "Two more on stage",
          p_start: "2026-10-16T01:00:00.000Z",
          p_end: "2026-10-16T05:00:00.000Z",
        },
      ],
    ]);
  });

  it("SCRUM-88/AC6 SupabaseEquipmentRequestWriter.update throws when the database refuses (not the assigned coordinator)", async () => {
    const { db } = rpcDb({ data: null, error: { message: "Only the event's assigned coordinator can change its equipment requests" } });
    await expect(new SupabaseEquipmentRequestWriter(db).update(change)).rejects.toThrow(/Changing the equipment request failed/);
  });
});
// end of SCRUM-87 Supabase reader and reviewer
