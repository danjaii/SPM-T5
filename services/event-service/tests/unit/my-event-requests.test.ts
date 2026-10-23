import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fake Supabase (in memory) so tests never touch the real database
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

const ORGANISER = "cs_session=token-organiser";
const OTHER_ORGANISER = "cs_session=token-organiser-2";
const COORDINATOR = "cs_session=token-coordinator";
const ATTENDEE = "cs_session=token-attendee";
const USER_IDS: Record<string, string> = {
  "token-organiser": "organiser-1",
  "token-organiser-2": "organiser-2",
  "token-coordinator": "coordinator-1",
  "token-attendee": "attendee-1",
};
const USERS: Row[] = [
  { id: "organiser-1", role: "event_organiser" },
  { id: "organiser-2", role: "event_organiser" },
  { id: "coordinator-1", role: "event_coordinator" },
  { id: "attendee-1", role: "attendee" },
];

function eventRow(overrides: Row = {}): Row {
  return {
    id: "evt-1",
    name: "Tech Summit",
    status: "submitted",
    preferred_start_datetime: "2026-11-20T01:00:00Z",
    expected_attendance: 100,
    submitted_at: "2026-10-01T02:00:00Z",
    created_at: "2026-10-01T01:00:00Z",
    organiser_id: "organiser-1",
    ...overrides,
  };
}

/** What the last events read asked for, so tests can see the limit and the columns. */
interface Seen {
  columns?: string;
  limit?: number;
  asToken?: string;
  /** Make the events read fail */
  fail?: boolean;
}

/** Pretends to be Supabase: .eq() narrows, .order() sorts, .limit() caps; awaiting gives the rows. */
function createFake(events: Row[], seen: Seen = {}) {
  // Like Supabase, a read returns only the columns it selected (filters and sorts may use others)
  const project = (rows: Row[]) =>
    seen.columns
      ? rows.map((row) => Object.fromEntries(seen.columns!.split(",").map((c) => c.trim()).map((c) => [c, row[c]])))
      : rows;
  const query = (rows: Row[]) => ({
    eq: (column: string, value: unknown) => query(rows.filter((row) => row[column] === value)),
    order: (column: string, { ascending = true }: { ascending?: boolean } = {}) =>
      query([...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1))),
    limit: (n: number) => {
      seen.limit = n;
      return query(rows.slice(0, n));
    },
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (result: unknown) => void) => resolve(seen.fail && seen.columns ? { data: null, error: { message: "boom" } } : { data: project(rows), error: null }),
  });
  return {
    anon: {
      auth: {
        getUser: async (token: string) =>
          USER_IDS[token]
            ? { data: { user: { id: USER_IDS[token] } }, error: null }
            : { data: { user: null }, error: { message: "bad token" } },
      },
    },
    forUser: (token: string) => ({
      from: (table: string) => ({
        select: (columns: string) => {
          if (table === "events") {
            seen.columns = columns;
            seen.asToken = token;
          }
          return query(table === "users" ? USERS : table === "events" ? events : []);
        },
      }),
    }),
  } as unknown as SupabaseDeps;
}

const get = (deps: SupabaseDeps, cookie?: string) => {
  const req = request(createApp(deps)).get("/events/my-requests");
  return cookie ? req.set("Cookie", cookie) : req;
};

describe("SCRUM-52/AC1 — an organiser lists their event requests (GET /events/my-requests)", () => {
  it("SCRUM-52/AC1 lists the name, status, start, attendance and submitted date of each of their requests", async () => {
    const res = await get(createFake([eventRow()]), ORGANISER);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: "evt-1",
        name: "Tech Summit",
        status: "submitted",
        preferred_start_datetime: "2026-11-20T01:00:00Z",
        expected_attendance: 100,
        submitted_at: "2026-10-01T02:00:00Z",
      },
    ]);
  });

  it("SCRUM-52/AC1 includes a request in every status, drafts too, with no draft handling", async () => {
    const statuses = ["draft", "submitted", "under_review", "returned", "approved", "rejected", "cancelled"];
    const events = statuses.map((status, i) => eventRow({ id: `evt-${i}`, status, created_at: `2026-10-0${i + 1}T00:00:00Z` }));

    const res = await get(createFake(events), ORGANISER);

    expect(res.body.map((e: Row) => e.status).sort()).toEqual([...statuses].sort());
  });

  it("SCRUM-52/AC1 lists the newest created request first", async () => {
    const events = [
      eventRow({ id: "old", created_at: "2026-09-01T00:00:00Z" }),
      eventRow({ id: "new", created_at: "2026-10-05T00:00:00Z" }),
      eventRow({ id: "mid", created_at: "2026-09-20T00:00:00Z" }),
    ];

    const res = await get(createFake(events), ORGANISER);

    expect(res.body.map((e: Row) => e.id)).toEqual(["new", "mid", "old"]);
  });

  it("SCRUM-52/AC1 is not capped at the dashboard's 25 rows", async () => {
    const events = Array.from({ length: 40 }, (_, i) => eventRow({ id: `evt-${i}`, created_at: `2026-10-01T00:00:${String(i).padStart(2, "0")}Z` }));
    const seen: Seen = {};

    const res = await get(createFake(events, seen), ORGANISER);

    expect(res.body).toHaveLength(40);
    expect(seen.limit).toBe(500);
  });

  it("SCRUM-52/AC1 returns an empty list for an organiser with no requests", async () => {
    const res = await get(createFake([eventRow({ organiser_id: "organiser-2" })]), ORGANISER);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("SCRUM-52/AC1 reads as the caller, so RLS decides, and selects only what the list needs", async () => {
    const seen: Seen = {};

    await get(createFake([eventRow()], seen), ORGANISER);

    expect(seen.asToken).toBe("token-organiser");
    expect(seen.columns).toBe("id, name, status, preferred_start_datetime, expected_attendance, submitted_at");
  });

  it("SCRUM-52/AC1 answers 500, not an empty list, when the requests cannot be read", async () => {
    const res = await get(createFake([eventRow()], { fail: true }), ORGANISER);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/couldn't load/i);
  });

  it.each([
    ["an event coordinator", COORDINATOR],
    ["an attendee", ATTENDEE],
  ])("SCRUM-52/AC1 refuses %s with 403", async (_who, cookie) => {
    const res = await get(createFake([eventRow()]), cookie);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not allowed/i);
  });

  it("SCRUM-52/AC1 answers 401 without a session", async () => {
    const res = await get(createFake([eventRow()]));

    expect(res.status).toBe(401);
  });
});
