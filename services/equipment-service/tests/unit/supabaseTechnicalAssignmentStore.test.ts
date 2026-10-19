import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { AssignmentStoreError, SupabaseTechnicalAssignmentStore } from "../../src/repositories/technicalAssignmentStore";

/**
 * SCRUM-20: how the Supabase assignment store reads rows and calls migration 41's functions. A pretend client records
 * every call; the real database is tested in tests/integration/technicalAssignments.test.ts.
 */

type Reply = { data: unknown; error: { message: string; code?: string } | null };

function stubDb(reply: Reply) {
  const calls: unknown[][] = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) {
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
    rpc: async (fn: string, args: unknown) => {
      calls.push(["rpc", fn, args]);
      return reply;
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

/** A row as PostgREST returns it, with the technician's and venue's names joined. */
const ROW = {
  id: "asg-1",
  event_id: "evt-1",
  staff_id: "tech-1",
  venue_booking_id: "vb-1",
  start_datetime: "2026-10-15T00:00:00+00:00",
  end_datetime: "2026-10-15T09:00:00+00:00",
  role_note: "Livestream desk",
  acknowledged_at: "2026-10-14T03:00:00+00:00",
  cancelled_at: null,
  cancellation_reason: null,
  staff: { full_name: "Aaron Koh" },
  booking: { venue: { name: "Grand Hall" } },
};

const INPUT = { venueBookingId: "vb-1", start: "2026-10-15T00:00:00.000Z", end: "2026-10-15T09:00:00.000Z", note: "Desk" };

describe("SCRUM-20 SupabaseTechnicalAssignmentStore", () => {
  it("20-S10: reads the event's assignments oldest first, with names, as records", async () => {
    const { db, calls } = stubDb({ data: [ROW], error: null });

    expect(await new SupabaseTechnicalAssignmentStore(db).forEvent("evt-1")).toEqual([
      {
        id: "asg-1",
        eventId: "evt-1",
        staffId: "tech-1",
        staffName: "Aaron Koh",
        venueBookingId: "vb-1",
        venueName: "Grand Hall",
        start: new Date("2026-10-15T00:00:00Z"),
        end: new Date("2026-10-15T09:00:00Z"),
        note: "Livestream desk",
        acknowledgedAt: new Date("2026-10-14T03:00:00Z"),
        cancelledAt: null,
        cancellationReason: null,
      },
    ]);
    expect(calls).toContainEqual(["from", "technical_staff_assignments"]);
    expect(calls).toContainEqual(["eq", "event_id", "evt-1"]);
    expect(calls).toContainEqual(["order", "assigned_at", { ascending: true }]);
  });

  it("20-S10: a row with no venue booking or technician name reads as null, not a crash", async () => {
    const { db } = stubDb({ data: { ...ROW, staff: null, booking: null, venue_booking_id: null, role_note: null }, error: null });

    expect(await new SupabaseTechnicalAssignmentStore(db).find("asg-1")).toMatchObject({
      staffName: null,
      venueBookingId: null,
      venueName: null,
      note: null,
    });
  });

  it("20-S10: find gives undefined for a missing row", async () => {
    expect(await new SupabaseTechnicalAssignmentStore(stubDb({ data: null, error: null }).db).find("x")).toBeUndefined();
  });

  it("20-S12: lists active Technical Support Staff by name", async () => {
    const { db, calls } = stubDb({ data: [{ id: "tech-1", full_name: "Aaron Koh" }], error: null });

    expect(await new SupabaseTechnicalAssignmentStore(db).staffOptions()).toEqual([{ id: "tech-1", name: "Aaron Koh" }]);
    expect(calls).toContainEqual(["eq", "role", "technical_support_staff"]);
    expect(calls).toContainEqual(["eq", "is_active", true]);
  });

  it("20-S1, 20-S4, 20-S6: assign, change and cancel call migration 41's functions with every value", async () => {
    const { db, calls } = stubDb({ data: "asg-new", error: null });
    const store = new SupabaseTechnicalAssignmentStore(db);

    expect(await store.assign("evt-1", { ...INPUT, staffId: "tech-2" })).toBe("asg-new");
    await store.change("asg-1", INPUT);
    await store.cancel("asg-1", "Moved online");

    expect(calls).toEqual([
      ["rpc", "assign_technical_staff", { p_event_id: "evt-1", p_staff_id: "tech-2", p_venue_booking_id: "vb-1", p_start: INPUT.start, p_end: INPUT.end, p_note: "Desk" }],
      ["rpc", "change_technical_assignment", { p_assignment_id: "asg-1", p_venue_booking_id: "vb-1", p_start: INPUT.start, p_end: INPUT.end, p_note: "Desk" }],
      ["rpc", "cancel_technical_assignment", { p_assignment_id: "asg-1", p_reason: "Moved online" }],
    ]);
  });

  it("20-S2: a refusal keeps its SQLSTATE so the service can answer it", async () => {
    const store = new SupabaseTechnicalAssignmentStore(stubDb({ data: null, error: { message: "Not allowed.", code: "42501" } }).db);

    const err = await store.cancel("asg-1", "x").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AssignmentStoreError);
    expect((err as AssignmentStoreError).code).toBe("42501");
  });

  it("20-S2: a read that fails throws, and a refusal with no code keeps an empty one", async () => {
    const failing = new SupabaseTechnicalAssignmentStore(stubDb({ data: null, error: { message: "down" } }).db);
    await expect(failing.forEvent("evt-1")).rejects.toThrow(/Reading assignments failed/);
    await expect(failing.find("asg-1")).rejects.toThrow(/Reading the assignment failed/);
    await expect(failing.staffOptions()).rejects.toThrow(/Reading technical support staff failed/);
    const err = await failing.change("asg-1", INPUT).catch((e: unknown) => e);
    expect((err as AssignmentStoreError).code).toBe("");
  });
});
