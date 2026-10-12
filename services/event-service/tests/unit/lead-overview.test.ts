import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-81: GET /lead/coordinators and GET /lead/coordinators/:id/events. Which coordinators and events are included, and
 * the counts, are decided by the database (migration 22; tests/integration/leadOverview.test.ts). These cover the routes.
 */
type Result = { data: unknown; error: { code?: string; message: string } | null };

const ROLES: Record<string, string> = {
  "token-lead": "event_coordinator_lead",
  "token-coordinator": "event_coordinator",
  "token-venue": "venue_staff",
  "token-organiser": "event_organiser",
};

function makeApp(results: Record<string, Result>) {
  const rpc = vi.fn(async (fn: string) => results[fn] ?? { data: null, error: { message: `no ${fn}` } });
  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) =>
          ROLES[token] ? { data: { user: { id: `user-${token}` } }, error: null } : { data: { user: null }, error: { message: "bad" } },
      },
    },
    forUser: (token: string) => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: ROLES[token] }, error: null }) }) }) }),
      rpc,
    }),
  } as unknown as SupabaseDeps;
  return { app: createApp(deps), rpc };
}

const coordinators = [
  { id: "c-1", full_name: "Rachel Tan", workload: 2 },
  { id: "c-2", full_name: "Marcus Lim", workload: 0 },
];
const events = [
  {
    id: "evt-1",
    name: "Tech Summit",
    status: "planning",
    preferred_start_datetime: "2031-06-15T01:00:00+00:00",
    preferred_end_datetime: "2031-06-15T09:00:00+00:00",
    expected_attendance: 120,
  },
];
const lead = "cs_session=token-lead";

describe("SCRUM-81 — Coordinator overview (GET /lead/coordinators)", () => {
  // AC1 + AC3: the Lead's active coordinators with their counts, including those at 0
  it("SCRUM-81/AC1 SCRUM-81/AC3 returns each coordinator with their workload count, including a count of 0", async () => {
    const { app, rpc } = makeApp({ lead_coordinator_overview: { data: coordinators, error: null } });

    const res = await request(app).get("/lead/coordinators").set("Cookie", lead);

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("lead_coordinator_overview");
    expect(res.body).toEqual(coordinators);
  });
  // end of AC1 + AC3

  // AC6: no coordinators is an empty list, not an error
  it("SCRUM-81/AC6 returns an empty list when no coordinators are linked to the Lead", async () => {
    const { app } = makeApp({ lead_coordinator_overview: { data: [], error: null } });

    const res = await request(app).get("/lead/coordinators").set("Cookie", lead);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
  // end of AC6

  // AC7: refused to anyone else, without reading anything
  it.each(["token-coordinator", "token-venue", "token-organiser"])("SCRUM-81/AC7 refuses the overview to a non-Lead (%s)", async (token) => {
    const { app, rpc } = makeApp({ lead_coordinator_overview: { data: coordinators, error: null } });

    const overview = await request(app).get("/lead/coordinators").set("Cookie", `cs_session=${token}`);
    const list = await request(app).get("/lead/coordinators/c-1/events").set("Cookie", `cs_session=${token}`);

    expect(overview.status).toBe(403);
    expect(list.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  // end of AC7

  it("SCRUM-81 reports a friendly error when the overview can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = makeApp({ lead_coordinator_overview: { data: null, error: { message: "boom" } } });

    const res = await request(app).get("/lead/coordinators").set("Cookie", lead);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't load your coordinators. Please try again." });
  });
});

describe("SCRUM-81 — One coordinator's events (GET /lead/coordinators/:id/events)", () => {
  // AC2: the coordinator's non-closed events, as the database lists them
  it("SCRUM-81/AC2 returns the coordinator's non-closed events with name, status, preferred date and time and attendance", async () => {
    const { app, rpc } = makeApp({ lead_coordinator_events: { data: events, error: null } });

    const res = await request(app).get("/lead/coordinators/c-1/events").set("Cookie", lead);

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("lead_coordinator_events", { p_coordinator_id: "c-1" });
    expect(res.body).toEqual(events);
  });
  // end of AC2

  // AC7 / BR4: the database refuses a coordinator the Lead doesn't supervise; the route says so
  it("SCRUM-81/AC7 refuses a coordinator the Lead does not supervise", async () => {
    const { app } = makeApp({ lead_coordinator_events: { data: null, error: { code: "42501", message: "not yours" } } });

    const res = await request(app).get("/lead/coordinators/c-9/events").set("Cookie", lead);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "You can only view coordinators you supervise." });
  });
  // end of AC7

  it("SCRUM-81 reports a friendly error when the events can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = makeApp({ lead_coordinator_events: { data: null, error: { message: "boom" } } });

    const res = await request(app).get("/lead/coordinators/c-1/events").set("Cookie", lead);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't load this coordinator's events. Please try again." });
  });
});
