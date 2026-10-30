import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-168: the assign and reassign steps offer each coordinator with their total expected attendance and whether they
 * clash with the event. The overlap rule itself is tested in packages/shared; these cover how the routes feed it.
 */
type Row = Record<string, unknown>;
type Events = Record<string, Row[] | "fails">;

function makeApp({ event, events }: { event: Row; events: Events }, team: Row[]) {
  const rpc = vi.fn(async (fn: string, args?: { p_coordinator_id?: string }) => {
    if (fn === "lead_coordinator_overview") return { data: team, error: null };
    const theirs = events[args?.p_coordinator_id ?? ""];
    return theirs === "fails" || !theirs ? { data: null, error: { message: "boom" } } : { data: theirs, error: null };
  });
  const deps = {
    anon: { auth: { getUser: async () => ({ data: { user: { id: "lead-1" } }, error: null }) } },
    forUser: () => ({
      from: (table: string) => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: table === "users" ? { role: "event_coordinator_lead" } : event, error: null }) }),
        }),
      }),
      rpc,
    }),
  } as unknown as SupabaseDeps;
  return { app: createApp(deps), rpc };
}

const base = {
  id: "evt-1",
  name: "Gala",
  status: "planning",
  assigned_coordinator_id: null,
  preferred_start_datetime: "2031-06-15T08:00:00+00:00",
  preferred_end_datetime: "2031-06-15T12:00:00+00:00",
  expected_attendance: 50,
  submitted_at: "2031-01-02T03:04:05+00:00",
  organiser: { full_name: "Jason Chua" },
};
const team = [
  { id: "c-1", full_name: "Rachel Tan", workload: 2 },
  { id: "c-2", full_name: "Marcus Lim", workload: 1 },
  { id: "c-3", full_name: "Siti Aminah", workload: 0 },
];
const during = {
  id: "e-1",
  name: "Tech Summit",
  preferred_start_datetime: "2031-06-15T09:00:00+00:00",
  preferred_end_datetime: "2031-06-15T10:00:00+00:00",
  expected_attendance: 120,
};
const elsewhere = {
  ...during,
  id: "e-2",
  name: "Later",
  preferred_start_datetime: "2031-07-01T09:00:00+00:00",
  preferred_end_datetime: "2031-07-01T10:00:00+00:00",
  expected_attendance: 30,
};
const lead = "cs_session=token-lead";
const choices = (res: request.Response): Record<string, Row> =>
  Object.fromEntries(res.body.coordinators.map((c: Row) => [c.id, c]));

describe("SCRUM-168 — coordinator choices on the assign step", () => {
  it("SCRUM-168/AC1 SCRUM-168/AC2 SCRUM-168/AC3 marks who clashes or is free, with total attendance", async () => {
    const { app } = makeApp({ event: base, events: { "c-1": [during, elsewhere], "c-2": [elsewhere], "c-3": [] } }, team);

    const res = await request(app).get("/lead/events/evt-1/assignment").set("Cookie", lead);

    expect(choices(res)["c-1"]).toMatchObject({ total_attendance: 150, clash: { status: "clash", eventId: "e-1", eventName: "Tech Summit" } });
    expect(choices(res)["c-2"]).toMatchObject({ total_attendance: 30, clash: { status: "free" } });
    expect(choices(res)["c-3"]).toMatchObject({ total_attendance: 0, clash: { status: "free" } });
  });

  it("SCRUM-168/AC4 SCRUM-168/AC5 still offers every coordinator when the event has no date, none called free", async () => {
    const undated = { ...base, preferred_start_datetime: null, preferred_end_datetime: null };
    const { app } = makeApp({ event: undated, events: { "c-1": [during], "c-2": [], "c-3": [] } }, team);

    const res = await request(app).get("/lead/events/evt-1/assignment").set("Cookie", lead);

    expect(res.body.coordinators).toHaveLength(3);
    expect(res.body.coordinators.every((c: Row) => (c.clash as Row).status === "no_date")).toBe(true);
  });

  it("SCRUM-168/AC4 still offers a coordinator whose events could not be read, marked unavailable", async () => {
    const { app } = makeApp({ event: base, events: { "c-1": "fails", "c-2": [], "c-3": [] } }, team);

    const res = await request(app).get("/lead/events/evt-1/assignment").set("Cookie", lead);

    expect(res.status).toBe(200);
    expect(choices(res)["c-1"]).toMatchObject({ total_attendance: null, clash: { status: "unavailable" } });
    expect(choices(res)["c-2"].clash).toEqual({ status: "free" });
  });
});

describe("SCRUM-168 — coordinator choices on the reassign step", () => {
  it("SCRUM-168/AC6 shows the same information, without the current coordinator", async () => {
    const held = { ...base, assigned_coordinator_id: "c-1", coordinator: { full_name: "Rachel Tan" } };
    const { app, rpc } = makeApp({ event: held, events: { "c-1": [during], "c-2": [during], "c-3": [] } }, team);

    const res = await request(app).get("/lead/events/evt-1/reassignment").set("Cookie", lead);

    expect(Object.keys(choices(res))).toEqual(["c-2", "c-3"]);
    expect(choices(res)["c-2"]).toMatchObject({ total_attendance: 120, clash: { status: "clash", eventName: "Tech Summit" } });
    expect(choices(res)["c-3"]).toMatchObject({ total_attendance: 0, clash: { status: "free" } });
    expect(rpc).not.toHaveBeenCalledWith("lead_coordinator_events", { p_coordinator_id: "c-1" });
  });
});
