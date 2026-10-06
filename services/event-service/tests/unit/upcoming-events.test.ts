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

/**
 * Pretends to be Supabase: one signed-in attendee, and list_public_events() answering with `rows`
 * (or, given `dbError`, failing the way supabase-js reports it: no data, and an error object).
 */
function createFake(rows: Row[], dbError: { message: string } | null = null): SupabaseDeps {
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
        return dbError ? { data: null, error: dbError } : { data: rows, error: null };
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

  // AC2: an event is upcoming only while its start time is in the future
  it("SCRUM-71/AC2 leaves out an event that has already started", async () => {
    const started = eventRow({ id: "evt-started", start_at: fromNow(-1 * HOUR), end_at: fromNow(1 * HOUR) });
    const tomorrow = eventRow({ id: "evt-tomorrow", start_at: fromNow(24 * HOUR), end_at: fromNow(26 * HOUR) });

    const res = await request(createApp(createFake([started, tomorrow]))).get("/events/upcoming").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(res.body.map((e: { id: string }) => e.id)).toEqual(["evt-tomorrow"]);
  });
  // end of AC2

  // AC5: sorted by start date, soonest first, whatever order the database returns them in
  it("SCRUM-71/AC5 lists events soonest first", async () => {
    const nextWeek = eventRow({ id: "evt-next-week", start_at: fromNow(7 * 24 * HOUR), end_at: fromNow(7 * 24 * HOUR + HOUR) });
    const tomorrow = eventRow({ id: "evt-tomorrow", start_at: fromNow(24 * HOUR), end_at: fromNow(25 * HOUR) });
    const inThreeDays = eventRow({ id: "evt-in-3-days", start_at: fromNow(3 * 24 * HOUR), end_at: fromNow(3 * 24 * HOUR + HOUR) });

    const res = await request(createApp(createFake([nextWeek, tomorrow, inThreeDays])))
      .get("/events/upcoming")
      .set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(res.body.map((e: { id: string }) => e.id)).toEqual(["evt-tomorrow", "evt-in-3-days", "evt-next-week"]);
  });
  // end of AC5

  // AC6: the list is only for logged-in users; no cookie or an unknown one gets 401 and no events
  it("SCRUM-71/AC6 refuses a caller who isn't signed in", async () => {
    const app = createApp(createFake([eventRow()]));

    const noCookie = await request(app).get("/events/upcoming");
    const badCookie = await request(app).get("/events/upcoming").set("Cookie", "cs_session=forged");

    expect(noCookie.status).toBe(401);
    expect(badCookie.status).toBe(401);
    expect(noCookie.body).toEqual({ error: "Not signed in." });
  });
  // end of AC6

  // AC7: a card says whether the event is cancelled, full or closed; "open" when none applies
  it("SCRUM-71/AC7 marks a cancelled event as cancelled, and an ordinary one as open", async () => {
    const cancelled = eventRow({ id: "evt-cancelled", status: "cancelled" });
    const ordinary = eventRow({ id: "evt-ordinary", status: "confirmed", start_at: fromNow(48 * HOUR) });

    const res = await request(createApp(createFake([cancelled, ordinary]))).get("/events/upcoming").set("Cookie", ATTENDEE);

    expect(res.body).toMatchObject([
      { id: "evt-cancelled", availability: "cancelled" },
      { id: "evt-ordinary", availability: "open" },
    ]);
  });

  // AC7: "Event Full" once the active registrations reach the capacity; an event with no capacity never fills up
  it("SCRUM-71/AC7 marks an event as full once its active registrations reach its capacity", async () => {
    const full = eventRow({ id: "evt-full", registration_capacity: 50, active_registrations: 50 });
    const oneSeatLeft = eventRow({
      id: "evt-one-seat-left",
      registration_capacity: 50,
      active_registrations: 49,
      start_at: fromNow(48 * HOUR),
    });
    const noCapacity = eventRow({
      id: "evt-no-capacity",
      registration_capacity: null,
      active_registrations: 500,
      start_at: fromNow(72 * HOUR),
    });

    const res = await request(createApp(createFake([full, oneSeatLeft, noCapacity])))
      .get("/events/upcoming")
      .set("Cookie", ATTENDEE);

    expect(res.body).toMatchObject([
      { id: "evt-full", availability: "full" },
      { id: "evt-one-seat-left", availability: "open" },
      { id: "evt-no-capacity", availability: "open" },
    ]);
  });

  // AC7: "Registration Closed" once the registration window has closed, even though the event is still upcoming
  it("SCRUM-71/AC7 marks an event as registration closed once registration_closes_at has passed", async () => {
    const closed = eventRow({ id: "evt-closed", registration_closes_at: fromNow(-1 * HOUR) });
    const stillOpen = eventRow({ id: "evt-still-open", registration_closes_at: fromNow(12 * HOUR), start_at: fromNow(48 * HOUR) });

    const res = await request(createApp(createFake([closed, stillOpen]))).get("/events/upcoming").set("Cookie", ATTENDEE);

    expect(res.body).toMatchObject([
      { id: "evt-closed", availability: "closed" },
      { id: "evt-still-open", availability: "open" },
    ]);
  });

  // AC7 (decided with the team): outside the registration window means closed, so "not open yet" counts too
  it("SCRUM-71/AC7 marks an event as registration closed while registration hasn't opened yet", async () => {
    const notYetOpen = eventRow({ id: "evt-not-yet-open", registration_opens_at: fromNow(6 * HOUR) });
    const alreadyOpen = eventRow({ id: "evt-already-open", registration_opens_at: fromNow(-6 * HOUR), start_at: fromNow(48 * HOUR) });

    const res = await request(createApp(createFake([notYetOpen, alreadyOpen]))).get("/events/upcoming").set("Cookie", ATTENDEE);

    expect(res.body).toMatchObject([
      { id: "evt-not-yet-open", availability: "closed" },
      { id: "evt-already-open", availability: "open" },
    ]);
  });

  // AC7: when several labels apply, only the highest priority shows: Cancelled, then Event Full, then Registration Closed
  it("SCRUM-71/AC7 shows only the highest-priority label when several apply", async () => {
    const everything = { registration_capacity: 10, active_registrations: 10, registration_closes_at: fromNow(-1 * HOUR) };
    const cancelledFullClosed = eventRow({ id: "evt-cancelled-full-closed", status: "cancelled", ...everything });
    const fullClosed = eventRow({ id: "evt-full-closed", ...everything, start_at: fromNow(48 * HOUR) });

    const res = await request(createApp(createFake([cancelledFullClosed, fullClosed])))
      .get("/events/upcoming")
      .set("Cookie", ATTENDEE);

    expect(res.body).toMatchObject([
      { id: "evt-cancelled-full-closed", availability: "cancelled" },
      { id: "evt-full-closed", availability: "full" },
    ]);
  });
  // end of AC7

  // AC10: the attendee's own active registration: registered is Confirmed, waitlisted is Pending
  it("SCRUM-71/AC10 reports the attendee's active registration as confirmed or pending", async () => {
    const confirmed = eventRow({ id: "evt-confirmed", my_registration_status: "registered" });
    const pending = eventRow({ id: "evt-pending", my_registration_status: "waitlisted", start_at: fromNow(48 * HOUR) });
    const notRegistered = eventRow({ id: "evt-not-registered", my_registration_status: null, start_at: fromNow(72 * HOUR) });

    const res = await request(createApp(createFake([confirmed, pending, notRegistered])))
      .get("/events/upcoming")
      .set("Cookie", ATTENDEE);

    expect(res.body).toMatchObject([
      { id: "evt-confirmed", my_registration: "confirmed" },
      { id: "evt-pending", my_registration: "pending" },
      { id: "evt-not-registered", my_registration: null },
    ]);
  });

  // AC10: after Rejected or Withdrawn the attendee can register again, so those count as no registration
  it("SCRUM-71/AC10 treats a withdrawn or rejected (cancelled) registration as none", async () => {
    const withdrawn = eventRow({ id: "evt-withdrawn", my_registration_status: "withdrawn" });
    const rejected = eventRow({ id: "evt-rejected", my_registration_status: "cancelled", start_at: fromNow(48 * HOUR) });

    const res = await request(createApp(createFake([withdrawn, rejected]))).get("/events/upcoming").set("Cookie", ATTENDEE);

    expect(res.body).toMatchObject([
      { id: "evt-withdrawn", my_registration: null },
      { id: "evt-rejected", my_registration: null },
    ]);
  });
  // end of AC10

  // AC11: "No upcoming events" must mean there are none, so a failed database call is an error, not an empty list
  it("SCRUM-71/AC11 reports an error, not an empty list, when the database call fails", async () => {
    const fake = createFake([], { message: "Could not find the function public.list_public_events" });

    const res = await request(createApp(fake)).get("/events/upcoming").set("Cookie", ATTENDEE);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't load upcoming events. Please try again." });
  });
  // end of AC11
});
// end of SCRUM-71
