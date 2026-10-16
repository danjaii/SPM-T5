import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-67: the event's coordinator reviews an organiser's change request (docs/specs/review-change-request.md). The database
 * applies or rejects it in one step (review_change_request(), migration 42; tests/integration/reviewChangeRequestDb.test.ts);
 * these cover the routes: who may review, what the review shows, and what they send the database.
 */

// ----------------------------------------------------------------------------
// Test setup: an in-memory database. "Tech Summit" (Sat 12 Dec 2031, 9am-5pm Singapore time, 120 people) is assigned to the
// coordinator; Orchid Hall (holds 130) is booked for it; the organiser asked to raise attendance to 150.
// ----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type DbError = { code?: string; message: string };

const USERS: Record<string, string> = {
  "token-coordinator": "event_coordinator",
  "token-other-coordinator": "event_coordinator",
  "token-organiser": "event_organiser",
};

const anEvent = (over: Row = {}): Row => ({
  id: "evt-1",
  name: "Tech Summit",
  status: "planning",
  organiser_id: "user-token-organiser",
  assigned_coordinator_id: "user-token-coordinator",
  description: null,
  purpose: null,
  event_category_id: null,
  preferred_start_datetime: "2031-12-12T01:00:00+00:00",
  preferred_end_datetime: "2031-12-12T09:00:00+00:00",
  expected_attendance: 120,
  preferred_room_layout_id: null,
  accessibility_requirements: null,
  venue_requirements: "Stage",
  equipment_requirements_notes: "Two projectors",
  ...over,
});

const aRequest = (over: Row = {}): Row => ({
  id: "cr-1",
  event_id: "evt-1",
  change_description: "Changed: expected attendance",
  proposed_changes: { expected_attendance: { from: 120, to: 150 } },
  status: "pending",
  requested_at: "2031-10-01T00:00:00Z",
  reviewed_at: null,
  review_notes: null,
  ...over,
});

const orchidHall: Row = {
  id: "vb-orchid",
  event_id: "evt-1",
  status: "approved",
  event_start_datetime: "2031-12-12T02:00:00+00:00",
  event_end_datetime: "2031-12-12T04:00:00+00:00",
  snapshot_expected_attendance: 120,
  venue: { name: "Orchid Hall", max_capacity: 130 },
};

function setup({
  event = anEvent(),
  changeRequest = aRequest(),
  bookings = [orchidHall] as Row[],
  rpcError = null as DbError | null,
  bookingsError = null as DbError | null,
} = {}) {
  const tables: Record<string, Row[]> = {
    users: Object.entries(USERS).map(([token, role]) => ({ id: `user-${token}`, role })),
    events: [event],
    event_change_requests: changeRequest ? [changeRequest] : [],
    venue_bookings: bookings,
    equipment_reservations: [],
  };
  const rpcCalls: [string, Row][] = [];
  const inserted: Row[] = [];

  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    const matching = () => tables[table].filter((r) => filters.every(([col, val]) => r[col] === val));
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      order: () => builder,
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) =>
        resolve(table === "venue_bookings" && bookingsError ? { data: null, error: bookingsError } : { data: matching(), error: null }),
      insert: (row: Row) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "cr-new", ...row }, error: null }) }) };
      },
    };
    return builder;
  };

  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) =>
          USERS[token] ? { data: { user: { id: `user-${token}` } }, error: null } : { data: { user: null }, error: { message: "bad" } },
      },
    },
    forUser: () => ({
      from: query,
      rpc: async (fn: string, args: Row) => {
        rpcCalls.push([fn, args]);
        return { data: null, error: rpcError };
      },
    }),
  } as unknown as SupabaseDeps;

  const app = createApp(deps, { now: () => new Date("2031-10-01T00:00:00Z") });
  const as = (token: string | null, req: request.Test) => (token ? req.set("Cookie", `cs_session=${token}`) : req);
  return {
    rpcCalls,
    inserted,
    view: (id = "cr-1", token: string | null = "token-coordinator") => as(token, request(app).get(`/change-requests/${id}`)),
    approve: (id = "cr-1", token: string | null = "token-coordinator") => as(token, request(app).post(`/change-requests/${id}/approve`)),
    reject: (body: object, id = "cr-1", token: string | null = "token-coordinator") =>
      as(token, request(app).post(`/change-requests/${id}/reject`).send(body)),
    submit: (body: object) => as("token-organiser", request(app).post("/events/evt-1/change-requests").send(body)),
  };
}

// end of test setup

describe("SCRUM-67/AC2 GET /change-requests/:id shows each requested change with the current value (67-S2)", () => {
  it("67-S2, 67-S4: the request, each change with the current value, what can be done, and the arrangements it affects", async () => {
    const res = await setup().view();

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({
      id: "cr-1",
      eventId: "evt-1",
      eventName: "Tech Summit",
      status: "pending",
      changeDescription: "Changed: expected attendance",
      requestedAt: "2031-10-01T00:00:00Z",
      reviewNotes: null,
      rows: [{ field: "expected_attendance", label: "Expected attendance", current: 120, requested: 150, changedSince: false, supported: true }],
      outdated: false,
      unsupported: [],
      canApprove: true,
      canReject: true,
    });
    expect(res.body.affected).toEqual([expect.objectContaining({ kind: "venue_booking", id: "vb-orchid", name: "Orchid Hall" })]);
  });

  it("67-S5: a request the event has moved on from cannot be approved, only rejected", async () => {
    const res = await setup({ event: anEvent({ expected_attendance: 130 }) }).view();

    expect(res.body).toMatchObject({ outdated: true, canApprove: false, canReject: true });
    expect(res.body.rows[0]).toMatchObject({ current: 130, changedSince: true });
  });

  it("67-S5: a request with a change the system cannot apply cannot be approved", async () => {
    const res = await setup({ changeRequest: aRequest({ proposed_changes: { registration_capacity: 38 } }) }).view();

    expect(res.body).toMatchObject({ unsupported: ["registration_capacity"], canApprove: false, canReject: true });
  });

  it("67-S10: a decided request shows its outcome and offers nothing", async () => {
    const res = await setup({ changeRequest: aRequest({ status: "rejected", review_notes: "Hall too small", reviewed_at: "2031-10-02T00:00:00Z" }) }).view();

    expect(res.body).toMatchObject({ status: "rejected", reviewNotes: "Hall too small", reviewedAt: "2031-10-02T00:00:00Z", canApprove: false, canReject: false, affected: [] });
  });

  it("67-S11: a finished event's request can still be rejected but not approved", async () => {
    const res = await setup({ event: anEvent({ status: "completed" }) }).view();

    expect(res.body).toMatchObject({ canApprove: false, canReject: true });
  });

  it("67-S9: another coordinator and the organiser are refused (403); an unknown request is 404; no session is 401", async () => {
    const s = setup();
    expect((await s.view("cr-1", "token-other-coordinator")).status).toBe(403);
    expect((await s.view("cr-1", "token-organiser")).status).toBe(403);
    expect((await s.view("cr-missing")).status).toBe(404);
    expect((await s.view("cr-1", null)).status).toBe(401);
  });
});

describe("SCRUM-67/AC3 POST /change-requests/:id/approve (67-S3, 67-S4, 67-S5)", () => {
  it("67-S3, 67-S4: sends the request's changes and the arrangements they affect to review_change_request", async () => {
    const s = setup();

    const res = await s.approve();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "approved" });
    expect(s.rpcCalls).toEqual([
      [
        "review_change_request",
        {
          p_request_id: "cr-1",
          p_approve: true,
          p_changes: { expected_attendance: { from: 120, to: 150 } },
          p_send_back: { venue_bookings: ["vb-orchid"], equipment_requests: [] },
        },
      ],
    ]);
  });

  it("67-S3: a change that affects no arrangement sends nothing back", async () => {
    const s = setup({ bookings: [] });

    await s.approve();

    expect(s.rpcCalls[0][1]).not.toHaveProperty("p_send_back");
  });

  it("67-S5, 67-S10, 67-S11, 67-S9: refusals the route can see itself, before calling the database", async () => {
    const cases: [ReturnType<typeof setup>, string | null, number, string | undefined][] = [
      [setup({ event: anEvent({ expected_attendance: 130 }) }), "token-coordinator", 409, "OUTDATED"],
      [setup({ changeRequest: aRequest({ proposed_changes: { registration_capacity: 38 } }) }), "token-coordinator", 409, "UNSUPPORTED"],
      [setup({ changeRequest: aRequest({ proposed_changes: {} }) }), "token-coordinator", 409, "UNSUPPORTED"],
      [setup({ changeRequest: aRequest({ status: "approved" }) }), "token-coordinator", 409, "ALREADY_REVIEWED"],
      [setup({ event: anEvent({ status: "completed" }) }), "token-coordinator", 409, "EVENT_LOCKED"],
      [setup(), "token-other-coordinator", 403, undefined],
    ];
    for (const [s, token, status, code] of cases) {
      const res = await s.approve("cr-1", token);
      expect([res.status, res.body.code]).toEqual([status, code]);
      expect(s.rpcCalls).toEqual([]);
    }
  });

  it("67-S5, 67-S10: the database's refusals come back as clear answers", async () => {
    const cases: [string, number, string | undefined][] = [
      ["CS111", 409, "OUTDATED"],
      ["CS067", 409, "ALREADY_REVIEWED"],
      ["CS112", 409, "EVENT_LOCKED"],
      ["22023", 409, "UNSUPPORTED"],
      ["42501", 403, undefined],
      ["XX000", 500, undefined],
    ];
    for (const [code, status, apiCode] of cases) {
      const res = await setup({ rpcError: { code, message: "refused" } }).approve();
      expect([res.status, res.body.code]).toEqual([status, apiCode]);
    }
  });

  it("67-S4: if the arrangements can't be read, nothing is approved", async () => {
    const s = setup({ bookingsError: { message: "boom" } });

    expect((await s.approve()).status).toBe(500);
    expect(s.rpcCalls).toEqual([]);
  });
});

describe("SCRUM-67/AC4, AC5 POST /change-requests/:id/reject (67-S6, 67-S7)", () => {
  it("67-S7: sends the trimmed reason to review_change_request", async () => {
    const s = setup();

    const res = await s.reject({ reason: "  The hall cannot hold 150 " });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "rejected" });
    expect(s.rpcCalls).toEqual([["review_change_request", { p_request_id: "cr-1", p_approve: false, p_reason: "The hall cannot hold 150" }]]);
  });

  it("67-S6: no reason is 422 with a message on the reason, and nothing is sent", async () => {
    const s = setup();

    const res = await s.reject({ reason: " " });

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toHaveProperty("reason");
    expect(s.rpcCalls).toEqual([]);
  });

  it("67-S10, 67-S9: a decided request is 409, another coordinator 403, and a database refusal is answered", async () => {
    expect((await setup({ changeRequest: aRequest({ status: "rejected" }) }).reject({ reason: "x" })).body.code).toBe("ALREADY_REVIEWED");
    expect((await setup().reject({ reason: "x" }, "cr-1", "token-other-coordinator")).status).toBe(403);
    expect((await setup({ rpcError: { code: "CS067", message: "x" } }).reject({ reason: "x" })).body.code).toBe("ALREADY_REVIEWED");
  });
});

describe("SCRUM-67 fix to SCRUM-66: a venue requirements change is recorded from the event's real value", () => {
  it("67-S5: the request's 'from' is the event's venue requirements, so it matches when reviewed", async () => {
    const s = setup();

    const res = await s.submit({ venueRequirements: "Stage and lift" });

    expect(res.status).toBe(201);
    expect(s.inserted[0].proposed_changes).toEqual({ venue_requirements: { from: "Stage", to: "Stage and lift" } });
  });
});
