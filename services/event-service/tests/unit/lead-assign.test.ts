import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-78: GET /lead/events/:id/assignment (what the assign step shows) and POST /lead/events/:id/assign. The database
 * enforces the rules (lead_assign_coordinator(), migration 23; tests/integration/leadAssign.test.ts); these cover how
 * the routes call it and turn its answers into responses.
 */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string } | null };

const ROLES: Record<string, string> = {
  "token-lead": "event_coordinator_lead",
  "token-coordinator": "event_coordinator",
  "token-venue": "venue_staff",
  "token-organiser": "event_organiser",
};

function makeApp({ event = null as Row | null, rpcs = {} as Record<string, Result> } = {}) {
  const rpc = vi.fn(async (fn: string) => rpcs[fn] ?? { data: null, error: { message: `no ${fn}` } });
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
          eq: () => ({
            maybeSingle: async () =>
              table === "users" ? { data: { role: ROLES[token] }, error: null } : { data: event, error: null },
          }),
        }),
      }),
      rpc,
    }),
  } as unknown as SupabaseDeps;
  return { app: createApp(deps), rpc };
}

const unassigned: Row = {
  id: "evt-1",
  name: "Tech Summit",
  status: "submitted",
  assigned_coordinator_id: null,
  preferred_start_datetime: "2031-06-15T01:00:00+00:00",
  preferred_end_datetime: "2031-06-15T09:00:00+00:00",
  expected_attendance: 120,
  submitted_at: "2031-01-02T03:04:05+00:00",
  organiser: { full_name: "Jason Chua" },
};
const coordinators = [
  { id: "c-1", full_name: "Rachel Tan", workload: 2 },
  { id: "c-2", full_name: "Marcus Lim", workload: 0 },
];
const lead = "cs_session=token-lead";

describe("SCRUM-78 — The assign step (GET /lead/events/:id/assignment)", () => {
  // AC1: an unassigned, non-closed event offers the Lead's eligible coordinators with their workload counts
  it("SCRUM-78/AC1 offers the eligible coordinators, each with their workload count, for an unassigned event", async () => {
    const { app, rpc } = makeApp({ event: unassigned, rpcs: { lead_coordinator_overview: { data: coordinators, error: null } } });

    const res = await request(app).get("/lead/events/evt-1/assignment").set("Cookie", lead);

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("lead_coordinator_overview");
    expect(res.body).toEqual({
      event: {
        id: "evt-1",
        name: "Tech Summit",
        status: "submitted",
        organiser_name: "Jason Chua",
        preferred_start_datetime: "2031-06-15T01:00:00+00:00",
        preferred_end_datetime: "2031-06-15T09:00:00+00:00",
        expected_attendance: 120,
        submitted_at: "2031-01-02T03:04:05+00:00",
      },
      canAssign: true,
      coordinators,
    });
  });
  // end of AC1

  // AC6: a closed event has no assign action (and no choices)
  it.each(["completed", "cancelled", "rejected"])("SCRUM-78/AC6 offers no assign action for a %s event", async (status) => {
    const { app, rpc } = makeApp({ event: { ...unassigned, status }, rpcs: { lead_coordinator_overview: { data: coordinators, error: null } } });

    const res = await request(app).get("/lead/events/evt-1/assignment").set("Cookie", lead);

    expect(res.status).toBe(200);
    expect(res.body.canAssign).toBe(false);
    expect(res.body.coordinators).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("SCRUM-78/AC3 offers no assign action for an event that already has a coordinator", async () => {
    const { app } = makeApp({ event: { ...unassigned, assigned_coordinator_id: "c-1" } });

    const res = await request(app).get("/lead/events/evt-1/assignment").set("Cookie", lead);

    expect(res.body.canAssign).toBe(false);
  });
  // end of AC6

  // AC7: no eligible coordinators is an empty list (the page says none are available)
  it("SCRUM-78/AC7 returns no choices when the Lead has no eligible coordinators", async () => {
    const { app } = makeApp({ event: unassigned, rpcs: { lead_coordinator_overview: { data: [], error: null } } });

    const res = await request(app).get("/lead/events/evt-1/assignment").set("Cookie", lead);

    expect(res.body.canAssign).toBe(true);
    expect(res.body.coordinators).toEqual([]);
  });
  // end of AC7

  it("SCRUM-78 says the event wasn't found when the Lead can't see it", async () => {
    const { app } = makeApp({ event: null });

    const res = await request(app).get("/lead/events/evt-x/assignment").set("Cookie", lead);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Event not found." });
  });
});

describe("SCRUM-78 — Confirm the assignment (POST /lead/events/:id/assign)", () => {
  const assign = (app: ReturnType<typeof createApp>, body: Row, cookie = lead) =>
    request(app).post("/lead/events/evt-1/assign").set("Cookie", cookie).send(body);

  // AC2: confirming assigns the chosen coordinator through lead_assign_coordinator()
  it("SCRUM-78/AC2 assigns the chosen coordinator", async () => {
    const { app, rpc } = makeApp({ rpcs: { lead_assign_coordinator: { data: [{ assigned_coordinator_id: "c-1" }], error: null } } });

    const res = await assign(app, { coordinator_id: "c-1" });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("lead_assign_coordinator", { p_event_id: "evt-1", p_coordinator_id: "c-1" });
    expect(res.body).toEqual({ assigned_coordinator_id: "c-1" });
  });

  it("SCRUM-78/AC2 asks for a coordinator when none is chosen", async () => {
    const { app, rpc } = makeApp();

    const res = await assign(app, {});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Choose a coordinator." });
    expect(rpc).not.toHaveBeenCalled();
  });
  // end of AC2

  // The database's refusals, turned into what the Lead is told
  it.each([
    // AC5: someone else assigned it first
    ["SCRUM-78/AC5", "CL002", 409, "This event has already been assigned to a coordinator."],
    // AC6: closed
    ["SCRUM-78/AC6", "CL001", 409, "This event is closed, so its coordinator can't be changed."],
    // AC7 / BR4: not one of the Lead's active coordinators
    ["SCRUM-78/AC7", "CL003", 422, "Choose one of your active coordinators."],
    ["SCRUM-78", "P0002", 404, "Event not found."],
    // AC9: the database also refuses anyone who isn't a Lead
    ["SCRUM-78/AC9", "42501", 403, "Only an Event Coordinator Lead can do this."],
  ])("%s answers the database's %s refusal with %i", async (_ac, code, status, message) => {
    const { app } = makeApp({ rpcs: { lead_assign_coordinator: { data: null, error: { code, message: "refused" } } } });

    const res = await assign(app, { coordinator_id: "c-1" });

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: message });
  });

  it("SCRUM-78 reports a friendly error for anything else the database reports", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = makeApp({ rpcs: { lead_assign_coordinator: { data: null, error: { code: "XX000", message: "boom" } } } });

    const res = await assign(app, { coordinator_id: "c-1" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't assign the coordinator. Please try again." });
  });

  // AC9: a non-Lead is refused before anything is called, so nothing can change
  it.each(["token-coordinator", "token-venue", "token-organiser"])("SCRUM-78/AC9 refuses %s and changes nothing", async (token) => {
    const { app, rpc } = makeApp({ event: unassigned });

    const view = await request(app).get("/lead/events/evt-1/assignment").set("Cookie", `cs_session=${token}`);
    const res = await assign(app, { coordinator_id: "c-1" }, `cs_session=${token}`);

    expect(view.status).toBe(403);
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  // end of AC9
});
