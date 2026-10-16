import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-99 (docs/specs/operational-safety-check.md): the Operational Safety Check routes. Which events are ready, what
 * the safety information is, and whether a decision may be saved are decided by the database functions in migration 35
 * (see tests/integration/safetyCheckDb.test.ts). These tests cover the routes: who may call them and what they return.
 */
type Row = Record<string, unknown>;
type RpcResult = { data: unknown; error: { code?: string; message: string } | null };

const ROLES: Record<string, string> = {
  "token-safety": "safety_officer",
  "token-coordinator": "event_coordinator",
  "token-lead": "event_coordinator_lead",
  "token-venue": "venue_staff",
  "token-organiser": "event_organiser",
};

function makeApp(result: RpcResult) {
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

const queueRow = (over: Row = {}): Row => ({
  id: "evt-1",
  name: "Tech Summit",
  preferred_start_datetime: "2031-06-15T01:00:00Z",
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 120,
  venue_names: ["Riverside Hall"],
  ...over,
});

describe("SCRUM-99/AC2 view events waiting for a safety check (GET /safety-checks)", () => {
  it("SCRUM-99/AC2 gives a Safety Officer every event the database says is ready", async () => {
    const ready = [queueRow({ id: "evt-1" }), queueRow({ id: "evt-2", name: "Expo" })];
    const { app, rpc } = makeApp({ data: ready, error: null });

    const res = await request(app).get("/safety-checks").set("Cookie", "cs_session=token-safety");

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("safety_check_queue");
    expect(res.body).toEqual(ready);
  });

  it.each(["token-coordinator", "token-lead", "token-venue", "token-organiser"])(
    "SCRUM-99/AC2 refuses the queue to a non-Safety-Officer (%s) without reading it",
    async (token) => {
      const { app, rpc } = makeApp({ data: [queueRow()], error: null });

      const res = await request(app).get("/safety-checks").set("Cookie", `cs_session=${token}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Only a Safety Officer can do this." });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  // An empty list would tell the Safety Officer nothing is waiting, so a failure must look like one
  it("SCRUM-99/AC2 answers 500, not an empty queue, when the database fails", async () => {
    const { app } = makeApp({ data: null, error: { message: "connection lost" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).get("/safety-checks").set("Cookie", "cs_session=token-safety");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't load the events waiting for a safety check. Please try again." });
  });
});

/** One event's safety information, as safety_check_details() (migration 35) returns it. */
const details = {
  id: "evt-1",
  name: "Tech Summit",
  status: "awaiting_arrangements",
  expected_attendance: 120, // Expected attendance
  accessibility_requirements: "Two wheelchair spaces near the stage", // Accessibility requirements
  layout: "Theatre", // Layout
  preferred_start_datetime: "2031-06-15T01:00:00+00:00",
  preferred_end_datetime: "2031-06-15T09:00:00+00:00",
  venues: [
    {
      name: "Riverside Hall",
      start: "2031-06-15T01:00:00+00:00",
      end: "2031-06-15T09:00:00+00:00",
      max_capacity: 150, // Venue capacity
      layout_capacity: 130, // and how many it holds in the event's layout
      emergency_access: "Two fire exits on the east wall", // Emergency access
      accessibility_notes: "Step-free entrance",
      restrictions: "No open flames", // Known venue restrictions
      unavailability: [],
    },
  ],
  equipment: [{ name: "PA System", quantity: 2, placement: "Either side of the stage" }], // Equipment placement
  decisions: [],
};

describe("SCRUM-99/AC3 view safety information (GET /safety-checks/:id)", () => {
  it("SCRUM-99/AC3 gives the Safety Officer the event's safety information", async () => {
    const { app, rpc } = makeApp({ data: details, error: null });

    const res = await request(app).get("/safety-checks/evt-1").set("Cookie", "cs_session=token-safety");

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("safety_check_details", { p_event_id: "evt-1" });
    expect(res.body).toEqual(details);
  });

  it("SCRUM-99/AC3 answers 404 for an event that does not exist", async () => {
    const { app } = makeApp({ data: null, error: null });

    const res = await request(app).get("/safety-checks/missing").set("Cookie", "cs_session=token-safety");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Event not found." });
  });

  it("SCRUM-99/AC3 answers 500, not 404, when the database fails", async () => {
    const { app } = makeApp({ data: null, error: { message: "connection lost" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app).get("/safety-checks/evt-1").set("Cookie", "cs_session=token-safety");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't load this event's safety information. Please try again." });
  });
});

/** A saved decision, as record_safety_decision() (migration 35) returns it. */
const saved = (over: Row = {}): Row => ({
  id: "chk-1",
  event_id: "evt-1",
  decision: "approved",
  reason: null,
  decided_by: "user-token-safety",
  officer_name: "Farah Ismail",
  decided_at: "2031-06-01T02:00:00Z",
  ...over,
});

describe("SCRUM-99/AC4 + AC5 approve an event (POST /safety-checks/:id/decision)", () => {
  it("SCRUM-99/AC5 saves an Approve and marks the event Safety Approved", async () => {
    const { app, rpc } = makeApp({ data: saved(), error: null });

    const res = await request(app)
      .post("/safety-checks/evt-1/decision")
      .set("Cookie", "cs_session=token-safety")
      .send({ decision: "approved" });

    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("record_safety_decision", { p_event_id: "evt-1", p_decision: "approved", p_reason: null });
    expect(res.body).toEqual({ ...saved(), label: "Safety Approved" });
  });
});

describe("SCRUM-99/AC6 reject an event", () => {
  it("SCRUM-99/AC6 refuses a Reject without a reason with 400 and saves nothing", async () => {
    const { app, rpc } = makeApp({ data: saved({ decision: "rejected" }), error: null });

    const res = await request(app)
      .post("/safety-checks/evt-1/decision")
      .set("Cookie", "cs_session=token-safety")
      .send({ decision: "rejected", reason: "  " });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Give a reason for rejecting this event." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("SCRUM-99/AC8 record the decision", () => {
  it("SCRUM-99/AC8 records the reason and returns the officer, decision, date and time, and reason", async () => {
    const rejected = saved({ decision: "rejected", reason: "Fire exit blocked by the stage" });
    const { app, rpc } = makeApp({ data: rejected, error: null });

    const res = await request(app)
      .post("/safety-checks/evt-1/decision")
      .set("Cookie", "cs_session=token-safety")
      .send({ decision: "rejected", reason: "  Fire exit blocked by the stage " });

    expect(res.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith("record_safety_decision", {
      p_event_id: "evt-1",
      p_decision: "rejected",
      p_reason: "Fire exit blocked by the stage", // spaces around it are trimmed
    });
    expect(res.body).toMatchObject({
      officer_name: "Farah Ismail",
      decision: "rejected",
      decided_at: "2031-06-01T02:00:00Z",
      reason: "Fire exit blocked by the stage",
      label: "Safety Rejected",
    });
  });
});

describe("SCRUM-99/AC4 when the database refuses the decision", () => {
  it.each([
    ["SC002", 409, "This event isn't waiting for a safety check."], // not ready, or already decided
    ["P0002", 404, "Event not found."],
    ["XX000", 500, "We couldn't save your decision. Please try again."],
  ])("SCRUM-99/AC4 a %s refusal answers %i and saves nothing", async (code, status, error) => {
    const { app } = makeApp({ data: null, error: { code, message: "refused" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(app)
      .post("/safety-checks/evt-1/decision")
      .set("Cookie", "cs_session=token-safety")
      .send({ decision: "approved" });

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error });
  });
});
