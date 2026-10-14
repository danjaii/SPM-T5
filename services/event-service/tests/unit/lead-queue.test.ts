import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-77: GET /lead/queue, the shared queue of event requests waiting for a coordinator. Which events are in it, and
 * their order, is decided by the database (lead_unassigned_queue(), migration 21; see tests/integration/leadQueue.test.ts).
 * These tests cover the route: who may call it, what it returns, and what happens when the database fails.
 */
type Row = Record<string, unknown>;

const ROLES: Record<string, string> = {
  "token-lead": "event_coordinator_lead",
  "token-coordinator": "event_coordinator",
  "token-venue": "venue_staff",
  "token-organiser": "event_organiser",
  "token-attendee": "attendee",
};

function makeApp(queue: { data: Row[] | null; error: { message: string } | null }) {
  const rpc = vi.fn(async () => queue);
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

const row = (over: Row = {}): Row => ({
  id: "evt-1",
  name: "Tech Summit",
  organiser_name: "Jason Chua",
  preferred_start_datetime: "2031-06-15T01:00:00Z",
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 120,
  submitted_at: "2031-01-02T03:04:05Z",
  ...over,
});

describe("SCRUM-77 — View unassigned event requests (GET /lead/queue)", () => {
  // AC1 + AC2 + AC3: the Lead gets the queue the database built, with every field the page shows, in the same order
  it("SCRUM-77/AC1 SCRUM-77/AC2 SCRUM-77/AC3 returns each waiting request with its details, in the database's order", async () => {
    const older = row({ id: "evt-old", submitted_at: "2031-01-01T00:00:00Z" });
    const newer = row({ id: "evt-new", submitted_at: "2031-02-01T00:00:00Z" });
    const { app, rpc } = makeApp({ data: [older, newer], error: null });

    const res = await request(app).get("/lead/queue").set("Cookie", "cs_session=token-lead");

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("lead_unassigned_queue");
    expect(res.body).toEqual([older, newer]);
  });
  // end of AC1-AC3

  // AC6: nothing waiting is an empty list, not an error (the page shows the message)
  it("SCRUM-77/AC6 returns an empty list when no requests are awaiting assignment", async () => {
    const { app } = makeApp({ data: [], error: null });

    const res = await request(app).get("/lead/queue").set("Cookie", "cs_session=token-lead");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
  // end of AC6

  // AC7: anyone else is refused by direct API call, and the queue is never read for them
  it.each(["token-coordinator", "token-venue", "token-organiser", "token-attendee"])(
    "SCRUM-77/AC7 refuses the queue to a non-Lead (%s) without reading it",
    async (token) => {
      const { app, rpc } = makeApp({ data: [row()], error: null });

      const res = await request(app).get("/lead/queue").set("Cookie", `cs_session=${token}`);

      expect(res.status).toBe(403);
      expect(res.body).not.toHaveProperty("length");
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("SCRUM-77/AC7 refuses the queue to a caller who is not signed in", async () => {
    const { app, rpc } = makeApp({ data: [row()], error: null });

    expect((await request(app).get("/lead/queue")).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  // end of AC7

  it("SCRUM-77 reports a friendly error, not internals, when the queue can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = makeApp({ data: null, error: { message: "relation does not exist" } });

    const res = await request(app).get("/lead/queue").set("Cookie", "cs_session=token-lead");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't load the unassigned event requests. Please try again." });
  });
});
