import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-126: GET /lead/summary, the figures beside the Lead's queue (events this month, the next event, reassignments this
 * week). The database works them out (lead_queue_summary(), migration 51); these tests cover the route.
 */
type Result = { data: unknown; error: { message: string } | null };

const ROLES: Record<string, string> = {
  "token-lead": "event_coordinator_lead",
  "token-coordinator": "event_coordinator",
  "token-organiser": "event_organiser",
};

function makeApp(result: Result) {
  const rpc = vi.fn(async () => result);
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

const summary = {
  events_this_month: 9,
  next_event_name: "Robotics Meetup",
  next_event_start: "2031-11-14T02:00:00Z",
  reassigned_this_week: 2,
};

describe("SCRUM-126 — Lead queue summary (GET /lead/summary)", () => {
  it("SCRUM-126/AC1 returns the Lead's summary row from lead_queue_summary()", async () => {
    const { app, rpc } = makeApp({ data: [summary], error: null });

    const res = await request(app).get("/lead/summary").set("Cookie", "cs_session=token-lead");

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("lead_queue_summary");
    expect(res.body).toEqual(summary);
  });

  it.each(["token-coordinator", "token-organiser"])("SCRUM-126/AC1 refuses the summary to a non-Lead (%s) without reading it", async (token) => {
    const { app, rpc } = makeApp({ data: [summary], error: null });

    expect((await request(app).get("/lead/summary").set("Cookie", `cs_session=${token}`)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("SCRUM-126/AC11 reports a friendly error, not internals, when the summary can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = makeApp({ data: null, error: { message: "function does not exist" } });

    const res = await request(app).get("/lead/summary").set("Cookie", "cs_session=token-lead");

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("function does not exist");
  });
});
