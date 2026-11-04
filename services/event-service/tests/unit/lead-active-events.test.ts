import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-189: GET /lead/events, every active event a Lead can see. Which rows RLS lets through is checked against the
 * database in tests/integration/leadActiveEvents.test.ts; these cover the route and the query it builds.
 */
type Result = { data: unknown; error: { message: string } | null };

const ROLES: Record<string, string> = {
  "token-lead": "event_coordinator_lead",
  "token-coordinator": "event_coordinator",
  "token-venue": "venue_staff",
  "token-organiser": "event_organiser",
};

function makeApp(result: Result) {
  const calls: unknown[][] = [];
  // Every step of the events query records itself and returns the query, which resolves to `result` when awaited
  const query = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), query),
    not: (...a: unknown[]) => (calls.push(["not", ...a]), query),
    order: (...a: unknown[]) => (calls.push(["order", ...a]), query),
    then: (resolve: (r: Result) => unknown) => resolve(result),
  };
  const from = vi.fn((table: string) =>
    table === "users"
      ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: ROLES[currentToken] }, error: null }) }) }) }
      : query,
  );
  let currentToken = "";
  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) =>
          ROLES[token] ? { data: { user: { id: `user-${token}` } }, error: null } : { data: { user: null }, error: { message: "bad" } },
      },
    },
    forUser: (token: string) => ((currentToken = token), { from }),
  } as unknown as SupabaseDeps;
  return { app: createApp(deps), from, calls };
}

const events = [
  {
    id: "evt-1",
    name: "Tech Summit",
    status: "planning",
    preferred_start_datetime: "2031-06-15T01:00:00+00:00",
    preferred_end_datetime: "2031-06-15T09:00:00+00:00",
    expected_attendance: 120,
    coordinator: { id: "c-1", full_name: "Rachel Tan" },
  },
];

describe("SCRUM-189 all active events (GET /lead/events)", () => {
  it("SCRUM-189/AC1 returns each event with its coordinator, earliest first", async () => {
    const { app, from, calls } = makeApp({ data: events, error: null });

    const res = await request(app).get("/lead/events").set("Cookie", "cs_session=token-lead");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(events);
    expect(from).toHaveBeenCalledWith("events");
    expect(String(calls.find((c) => c[0] === "select")?.[1])).toContain("coordinator:assigned_coordinator_id(id, full_name)");
    expect(calls.filter((c) => c[0] === "order")).toEqual([
      ["order", "preferred_start_datetime", { ascending: true, nullsFirst: false }],
      ["order", "name"],
    ]);
  });

  it("SCRUM-189/AC2 asks only for events with a coordinator that are not completed, cancelled or rejected", async () => {
    const { app, calls } = makeApp({ data: [], error: null });

    const res = await request(app).get("/lead/events").set("Cookie", "cs_session=token-lead");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(calls.filter((c) => c[0] === "not")).toEqual([
      ["not", "assigned_coordinator_id", "is", null],
      ["not", "status", "in", "(completed,cancelled,rejected)"],
    ]);
  });

  it.each(["token-coordinator", "token-venue", "token-organiser"])("SCRUM-189/AC5 refuses the list to a non-Lead (%s)", async (token) => {
    const { app, from } = makeApp({ data: events, error: null });

    const res = await request(app).get("/lead/events").set("Cookie", `cs_session=${token}`);

    expect(res.status).toBe(403);
    expect(from).not.toHaveBeenCalledWith("events");
  });

  it("SCRUM-189/AC5 refuses a caller who is not signed in", async () => {
    const { app } = makeApp({ data: events, error: null });

    const res = await request(app).get("/lead/events");

    expect(res.status).toBe(401);
  });

  it("SCRUM-189 reports a friendly error when the events can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { app } = makeApp({ data: null, error: { message: "boom" } });

    const res = await request(app).get("/lead/events").set("Cookie", "cs_session=token-lead");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't load the active events. Please try again." });
  });

  it("SCRUM-189/AC1 answers an empty list when the database returns no rows", async () => {
    const { app } = makeApp({ data: null, error: null });

    const res = await request(app).get("/lead/events").set("Cookie", "cs_session=token-lead");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
