import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fake Supabase (in memory) so tests never touch the real database
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

const HOUR = 60 * 60 * 1000;
/** A time relative to now, e.g. fromNow(24 * HOUR) is this time tomorrow. */
const fromNow = (ms: number) => new Date(Date.now() + ms).toISOString();

/** One row as the list_public_events() database function returns it (supabase/migrations/10_list_public_events.sql). */
function eventRow(overrides: Row = {}): Row {
  return {
    id: "evt-1",
    name: "Tech Summit",
    status: "confirmed",
    start_at: fromNow(24 * HOUR),
    end_at: fromNow(26 * HOUR),
    venue_name: "Orchid Hall",
    venue_address: "Level 3, East Wing",
    registration_capacity: null,
    registration_opens_at: null,
    registration_closes_at: null,
    active_registrations: 0,
    my_registration_status: null,
    ...overrides,
  };
}

/** The cookie a signed-in attendee's browser sends. */
const ATTENDEE = "cs_session=token-attendee";

/** Pretends to be Supabase: one signed-in attendee, and list_public_events() answering with `rows`. */
function createFake(rows: Row[]): SupabaseDeps {
  // Any table query finds nothing, like an empty database (these tests only need list_public_events)
  const emptyQuery = {
    select: () => emptyQuery,
    eq: () => emptyQuery,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  return {
    anon: {
      auth: {
        getUser: async (token: string) =>
          token === "token-attendee"
            ? { data: { user: { id: "attendee-1" } }, error: null }
            : { data: { user: null }, error: { message: "bad token" } },
      },
    },
    forUser: () => ({
      from: () => emptyQuery,
      rpc: async (fn: string) => {
        if (fn !== "list_public_events") throw new Error(`fake has no function ${fn}`);
        return { data: rows, error: null };
      },
    }),
  } as unknown as SupabaseDeps;
}
// end of fake Supabase

// ---------------------------------------------------------------------------
// SCRUM-71 — View Event Information: the attendee's List of events
// ---------------------------------------------------------------------------
describe("SCRUM-71 — Upcoming events (GET /events/upcoming)", () => {
  // AC1: each event comes back with what its card needs: name, date and time, and location
  it("SCRUM-71/AC1 returns each listed event's id, name, start and end time, and venue", async () => {
    const row = eventRow();

    const res = await request(createApp(createFake([row]))).get("/events/upcoming").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject([
      {
        id: "evt-1",
        name: "Tech Summit",
        start_at: row.start_at,
        end_at: row.end_at,
        venue: { name: "Orchid Hall", address: "Level 3, East Wing" },
      },
    ]);
  });
  // end of AC1
});
// end of SCRUM-71
