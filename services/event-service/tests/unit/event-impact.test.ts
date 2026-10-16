import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-112: PATCH /events/:id shows which venue bookings and equipment requests an important change affects before it
 * is saved (docs/specs/important-change-impact.md). Which ones, and why, is the shared rule (packages/shared/tests/
 * eventImpact.test.ts); these cover the route: when it asks, what it reads, and that confirming saves.
 */

// ----------------------------------------------------------------------------
// Test setup: "Tech Summit" (Sat 12 Dec 2026, 9am-5pm Singapore time, 480 people), assigned to "token-coordinator".
// Its arrangements: Orchid Hall (holds 500, 10am-12pm, approved, using the event's 480) and 2 projectors (10am-12pm,
// submitted).
// ----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string } | null };

const ROLES: Record<string, string> = {
  "token-coordinator": "event_coordinator",
  "token-other-coordinator": "event_coordinator",
};

const anEvent = (over: Row = {}): Row => ({
  id: "evt-1",
  status: "planning",
  assigned_coordinator_id: "user-token-coordinator",
  name: "Tech Summit",
  description: null,
  purpose: null,
  event_category_id: null,
  preferred_start_datetime: "2026-12-12T01:00:00+00:00",
  preferred_end_datetime: "2026-12-12T09:00:00+00:00",
  expected_attendance: 480,
  preferred_room_layout_id: null,
  accessibility_requirements: null,
  venue_requirements: null,
  equipment_requirements_notes: "Two projectors",
  ...over,
});

/** venue_bookings rows as the route reads them, with their venue. */
const orchidHall: Row = {
  id: "vb-orchid",
  status: "approved",
  event_start_datetime: "2026-12-12T02:00:00+00:00",
  event_end_datetime: "2026-12-12T04:00:00+00:00",
  snapshot_expected_attendance: 480,
  venue: { name: "Orchid Hall", max_capacity: 500 },
};

/** equipment_reservations rows as the route reads them, with their equipment. */
const projectors: Row = {
  id: "eq-projectors",
  status: "requested",
  quantity_requested: 2,
  start_datetime: "2026-12-12T02:00:00+00:00",
  end_datetime: "2026-12-12T04:00:00+00:00",
  equipment: { name: "Projector" },
};

const form = {
  name: "Tech Summit",
  description: "",
  purpose: "",
  categoryId: "",
  date: "2026-12-12",
  startTime: "09:00",
  endDate: "2026-12-12",
  endTime: "17:00",
  expectedAttendance: 480,
  roomLayoutId: "",
  accessibilityRequirements: "",
  venueRequirements: "",
  equipmentRequirements: "Two projectors",
};

function makeApp({
  event = anEvent() as Row | null,
  venueBookings = { data: [orchidHall], error: null } as Result,
  equipmentRequests = { data: [projectors], error: null } as Result,
} = {}) {
  const rpc = vi.fn(async () => ({ data: true, error: null }) as Result);
  /** every list read, as [table, column filtered on, value] */
  const reads: [string, string, unknown][] = [];
  const lists: Record<string, Result> = { venue_bookings: venueBookings, equipment_reservations: equipmentRequests };
  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) =>
          ROLES[token] ? { data: { user: { id: `user-${token}` } }, error: null } : { data: { user: null }, error: { message: "bad" } },
      },
    },
    forUser: (token: string) => ({
      from: (table: string) => ({
        select: () => ({
          eq: (column: string, value: unknown) => ({
            maybeSingle: async () => (table === "users" ? { data: { role: ROLES[token] }, error: null } : { data: event, error: null }),
            then: (resolve: (r: Result) => void) => {
              reads.push([table, column, value]);
              resolve(lists[table] ?? { data: [], error: null });
            },
          }),
        }),
      }),
      rpc,
    }),
  } as unknown as SupabaseDeps;
  const app = createApp(deps, { now: () => new Date("2026-10-01T00:00:00.000Z") });
  const edit = (body: object, token = "token-coordinator") =>
    request(app).patch("/events/evt-1").set("Cookie", `cs_session=${token}`).send({ ...form, ...body });
  return { edit, rpc, reads };
}

/** The event moved to Sun 13 Dec, same hours. */
const nextDay = { date: "2026-12-13", endDate: "2026-12-13" };

// end of test setup

describe("SCRUM-112/AC1, AC2, AC3 PATCH /events/:id lists the affected arrangements before saving", () => {
  it("112-S1: raising attendance past Orchid Hall's 500 is not saved; it answers 409 CONFIRM_IMPACT with the list", async () => {
    const { edit, rpc } = makeApp();

    const res = await edit({ expectedAttendance: 600 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONFIRM_IMPACT");
    expect(res.body.affected).toEqual([
      expect.objectContaining({
        id: "vb-orchid",
        reasons: ["Orchid Hall holds 500 people, but the event now expects 600. This venue booking is for 480. The venue may no longer be suitable."],
      }),
    ]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("112-S2: each listed venue booking and equipment request comes with its name, quantity, times and status", async () => {
    const { edit } = makeApp();

    const res = await edit(nextDay);

    expect(res.status).toBe(409);
    expect(res.body.affected).toEqual([
      {
        kind: "venue_booking",
        id: "vb-orchid",
        name: "Orchid Hall",
        quantity: null,
        start: "2026-12-12T02:00:00+00:00",
        end: "2026-12-12T04:00:00+00:00",
        statusLabel: "Approved",
        reasons: ["No longer within the event's new date and time."],
      },
      {
        kind: "equipment_request",
        id: "eq-projectors",
        name: "Projector",
        quantity: 2,
        start: "2026-12-12T02:00:00+00:00",
        end: "2026-12-12T04:00:00+00:00",
        statusLabel: "Submitted",
        reasons: ["No longer within the event's new date and time."],
      },
    ]);
  });

  it("112-S3: it reads only this event's venue bookings and equipment requests", async () => {
    const { edit, reads } = makeApp();

    await edit(nextDay);

    expect(reads).toEqual([
      ["venue_bookings", "event_id", "evt-1"],
      ["equipment_reservations", "event_id", "evt-1"],
    ]);
  });

  it("112-S1: if the arrangements can't be read, nothing is saved and it says so", async () => {
    const { edit, rpc } = makeApp({ venueBookings: { data: null, error: { message: "boom" } } });

    const res = await edit(nextDay);

    expect(res.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("SCRUM-112/AC5 confirming the change saves it", () => {
  it("112-S14: the same edit with confirmImpact: true is saved through update_event_details", async () => {
    const { edit, rpc } = makeApp();

    const res = await edit({ expectedAttendance: 600, confirmImpact: true });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("update_event_details", {
      p_event_id: "evt-1",
      p_changes: { expected_attendance: { from: 480, to: 600 } },
      // SCRUM-113: what the warning listed is sent back for review in the same step
      p_send_back: { venue_bookings: ["vb-orchid"], equipment_requests: [] },
    });
    expect(res.body.important).toBe(true);
  });

  it("112-S14: confirmImpact must be exactly true; anything else still asks first", async () => {
    const { edit, rpc } = makeApp();

    const res = await edit({ expectedAttendance: 600, confirmImpact: "yes" });

    expect(res.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("SCRUM-112/AC6 no warning when nothing is affected", () => {
  it("112-S15: an important change on an event with no arrangements is saved straight away", async () => {
    const { edit, rpc } = makeApp({ venueBookings: { data: [], error: null }, equipmentRequests: { data: [], error: null } });

    const res = await edit(nextDay);

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("112-S15: lowering attendance (to 300) affects no venue booking, so it is saved straight away", async () => {
    const { edit, rpc } = makeApp();

    const res = await edit({ expectedAttendance: 300 });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("112-S16: an ordinary change (the name) is saved without reading the arrangements", async () => {
    const { edit, rpc, reads } = makeApp();

    const res = await edit({ name: "Tech Summit 2026" });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(reads).toEqual([]);
  });
});

describe("SCRUM-112/AC7 and the SCRUM-111 checks come before any warning", () => {
  it("112-S17: an invalid attendance (0) gets 422 with the field error, no warning, nothing saved", async () => {
    const { edit, rpc, reads } = makeApp();

    const res = await edit({ expectedAttendance: 0 });

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toHaveProperty("expectedAttendance");
    expect(rpc).not.toHaveBeenCalled();
    expect(reads).toEqual([]);
  });

  it("112-S18: another coordinator is refused (403) without seeing the arrangements", async () => {
    const { edit, reads } = makeApp();

    const res = await edit(nextDay, "token-other-coordinator");

    expect(res.status).toBe(403);
    expect(res.body.affected).toBeUndefined();
    expect(reads).toEqual([]);
  });

  it("112-S18: a completed event is refused (409 EVENT_LOCKED) without a list", async () => {
    const { edit, reads } = makeApp({ event: anEvent({ status: "completed" }) });

    const res = await edit(nextDay);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVENT_LOCKED");
    expect(reads).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// SCRUM-113: Save anyway sends what the warning listed back for review (docs/specs/send-back-affected-arrangements.md).
// The database does the sending back (update_event_details(), migration 40; tests/integration/sendBackDb.test.ts); these
// cover which ids the route passes it.
// ----------------------------------------------------------------------------

describe("SCRUM-113/AC1, AC2, AC5 Save anyway passes the listed arrangements to update_event_details", () => {
  it("113-S1, 113-S3: moving the event a day sends back Orchid Hall and the projectors", async () => {
    const { edit, rpc } = makeApp();

    const res = await edit({ ...nextDay, confirmImpact: true });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_event_details", {
      p_event_id: "evt-1",
      p_changes: expect.any(Object),
      p_send_back: { venue_bookings: ["vb-orchid"], equipment_requests: ["eq-projectors"] },
    });
  });

  it("113-S11: an important change that affects nothing (attendance lowered) sends nothing back", async () => {
    const { edit, rpc } = makeApp();

    await edit({ expectedAttendance: 300 });

    expect(rpc).toHaveBeenCalledWith("update_event_details", {
      p_event_id: "evt-1",
      p_changes: { expected_attendance: { from: 480, to: 300 } },
    });
  });

  it("113-S11: an ordinary change sends nothing back, even with confirmImpact: true", async () => {
    const { edit, rpc, reads } = makeApp();

    await edit({ name: "Tech Summit 2026", confirmImpact: true });

    expect(rpc).toHaveBeenCalledWith("update_event_details", {
      p_event_id: "evt-1",
      p_changes: { name: { from: "Tech Summit", to: "Tech Summit 2026" } },
    });
    expect(reads).toEqual([]);
  });

  it("113-S1: if the arrangements can't be read on Save anyway, nothing is saved", async () => {
    const { edit, rpc } = makeApp({ equipmentRequests: { data: null, error: { message: "boom" } } });

    const res = await edit({ ...nextDay, confirmImpact: true });

    expect(res.status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });
});
