import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-79: GET /lead/events/:id/reassignment (what the reassign step shows) and POST /lead/events/:id/reassign. The
 * database enforces the rules (lead_reassign_coordinator(), migration 24; tests/integration/leadReassign.test.ts); these
 * cover how the routes call it and turn its answers into responses.
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

const assigned: Row = {
  id: "evt-1",
  name: "Tech Summit",
  status: "planning",
  assigned_coordinator_id: "c-1",
  preferred_start_datetime: "2031-06-15T01:00:00+00:00",
  preferred_end_datetime: "2031-06-15T09:00:00+00:00",
  expected_attendance: 120,
  submitted_at: "2031-01-02T03:04:05+00:00",
  organiser: { full_name: "Jason Chua" },
  coordinator: { full_name: "Rachel Tan" },
};
const team = [
  { id: "c-1", full_name: "Rachel Tan", workload: 3 },
  { id: "c-2", full_name: "Marcus Lim", workload: 1 },
  { id: "c-3", full_name: "Siti Aminah", workload: 0 },
];
const lead = "cs_session=token-lead";

describe("SCRUM-79 — The reassign step (GET /lead/events/:id/reassignment)", () => {
  // AC1 + AC2: a non-closed assigned event can be reassigned; the current coordinator is shown, and the choices are the
  // Lead's other eligible coordinators with their workload counts
  it("SCRUM-79/AC1 SCRUM-79/AC2 shows the current coordinator and offers the other eligible coordinators with their workload", async () => {
    const { app, rpc } = makeApp({ event: assigned, rpcs: { lead_coordinator_overview: { data: team, error: null } } });

    const res = await request(app).get("/lead/events/evt-1/reassignment").set("Cookie", lead);

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("lead_coordinator_overview");
    expect(res.body).toEqual({
      event: {
        id: "evt-1",
        name: "Tech Summit",
        status: "planning",
        organiser_name: "Jason Chua",
        preferred_start_datetime: "2031-06-15T01:00:00+00:00",
        preferred_end_datetime: "2031-06-15T09:00:00+00:00",
        expected_attendance: 120,
        submitted_at: "2031-01-02T03:04:05+00:00",
      },
      current: { id: "c-1", full_name: "Rachel Tan" },
      canReassign: true,
      coordinators: [team[1], team[2]],
    });
  });
  // end of AC1 + AC2

  // AC5: a closed event has no reassign action
  it.each(["completed", "cancelled", "rejected"])("SCRUM-79/AC5 offers no reassign action for a %s event", async (status) => {
    const { app, rpc } = makeApp({ event: { ...assigned, status }, rpcs: { lead_coordinator_overview: { data: team, error: null } } });

    const res = await request(app).get("/lead/events/evt-1/reassignment").set("Cookie", lead);

    expect(res.body.canReassign).toBe(false);
    expect(res.body.coordinators).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
  // end of AC5

  it("SCRUM-79/AC1 offers no reassign action for an event with no coordinator (that is an assignment)", async () => {
    const { app } = makeApp({ event: { ...assigned, assigned_coordinator_id: null, coordinator: null } });

    const res = await request(app).get("/lead/events/evt-1/reassignment").set("Cookie", lead);

    expect(res.body.canReassign).toBe(false);
    expect(res.body.current).toBeNull();
  });

  // AC6: nobody other than the current coordinator: no choices (the page says none are available)
  it("SCRUM-79/AC6 offers no choices when the current coordinator is the only eligible one", async () => {
    const { app } = makeApp({ event: assigned, rpcs: { lead_coordinator_overview: { data: [team[0]], error: null } } });

    const res = await request(app).get("/lead/events/evt-1/reassignment").set("Cookie", lead);

    expect(res.body.canReassign).toBe(true);
    expect(res.body.coordinators).toEqual([]);
  });
  // end of AC6

  it("SCRUM-79 says the event wasn't found when the Lead can't see it", async () => {
    const { app } = makeApp({ event: null });

    const res = await request(app).get("/lead/events/evt-x/reassignment").set("Cookie", lead);

    expect(res.status).toBe(404);
  });
});

describe("SCRUM-79 — Confirm the reassignment (POST /lead/events/:id/reassign)", () => {
  const reassign = (app: ReturnType<typeof createApp>, body: Row, cookie = lead) =>
    request(app).post("/lead/events/evt-1/reassign").set("Cookie", cookie).send(body);

  // AC3 + AC8: confirming reassigns through lead_reassign_coordinator(), which also records the change
  it("SCRUM-79/AC3 reassigns to the chosen coordinator", async () => {
    const { app, rpc } = makeApp({ rpcs: { lead_reassign_coordinator: { data: [{ assigned_coordinator_id: "c-2" }], error: null } } });

    const res = await reassign(app, { coordinator_id: "c-2" });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("lead_reassign_coordinator", { p_event_id: "evt-1", p_coordinator_id: "c-2" });
    expect(res.body).toEqual({ assigned_coordinator_id: "c-2" });
  });

  it("SCRUM-79/AC3 asks for a coordinator when none is chosen", async () => {
    const { app, rpc } = makeApp();

    const res = await reassign(app, {});

    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  // end of AC3

  it.each([
    ["SCRUM-79/AC5", "CL001", 409, "This event is closed, so its coordinator can't be changed."],
    ["SCRUM-79/AC6", "CL003", 422, "Choose one of your active coordinators."],
    ["SCRUM-79/AC2", "CL006", 409, "This coordinator is already assigned to the event."],
    ["SCRUM-79", "CL004", 409, "This event has no coordinator yet. Assign one from the unassigned queue."],
    ["SCRUM-79/AC9", "CL005", 403, "You can only reassign events held by coordinators you supervise."],
    ["SCRUM-79/AC9", "42501", 403, "Only an Event Coordinator Lead can do this."],
    ["SCRUM-79", "P0002", 404, "Event not found."],
  ])("%s answers the database's %s refusal with %i", async (_ac, code, status, message) => {
    const { app } = makeApp({ rpcs: { lead_reassign_coordinator: { data: null, error: { code, message: "refused" } } } });

    const res = await reassign(app, { coordinator_id: "c-2" });

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: message });
  });

  it("SCRUM-79 reports a friendly error for anything else the database reports", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = makeApp({ rpcs: { lead_reassign_coordinator: { data: null, error: { code: "XX000", message: "boom" } } } });

    const res = await reassign(app, { coordinator_id: "c-2" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't reassign the coordinator. Please try again." });
  });

  // AC9: a non-Lead is refused before anything is called, so nothing can change
  it.each(["token-coordinator", "token-venue", "token-organiser"])("SCRUM-79/AC9 refuses %s and changes nothing", async (token) => {
    const { app, rpc } = makeApp({ event: assigned });

    const view = await request(app).get("/lead/events/evt-1/reassignment").set("Cookie", `cs_session=${token}`);
    const res = await reassign(app, { coordinator_id: "c-2" }, `cs_session=${token}`);

    expect(view.status).toBe(403);
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  // end of AC9
});
