import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fake Supabase (in memory) so tests never touch the real database
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

/** The cookie each signed-in user's browser sends. */
const COORDINATOR = "cs_session=token-coordinator";
const ORGANISER = "cs_session=token-organiser";
const ATTENDEE = "cs_session=token-attendee";
/** Who each login token belongs to. */
const USER_IDS: Record<string, string> = {
  "token-coordinator": "coordinator-1",
  "token-organiser": "organiser-1",
  "token-attendee": "attendee-1",
};

/** The users table: each signed-in user's role. */
const USERS: Row[] = [
  { id: "coordinator-1", role: "event_coordinator" },
  { id: "organiser-1", role: "event_organiser" },
  { id: "attendee-1", role: "attendee" },
];

/** One events row (supabase/migrations/01_schema.sql). Organised by organiser-1 and assigned to coordinator-1 unless overridden. */
function eventRow(overrides: Row = {}): Row {
  return {
    id: "evt-1",
    name: "Tech Summit",
    status: "confirmed",
    preferred_start_datetime: "2026-11-20T01:00:00Z",
    registration_capacity: 100,
    organiser_id: "organiser-1",
    assigned_coordinator_id: "coordinator-1",
    ...overrides,
  };
}

/**
 * Pretends to be Supabase: the users, events and event_registrations tables hold the given rows.
 * Each .eq() narrows a read; awaiting it gives the list, maybeSingle() the first row.
 */
function createFake({
  events = [],
  registrations = [],
  contacts = [],
  contactsError = null,
}: { events?: Row[]; registrations?: Row[]; contacts?: Row[]; contactsError?: { message: string } | null } = {}) {
  const tables: Record<string, Row[]> = { users: USERS, events, event_registrations: registrations };
  // every database function the route called (SCRUM-154: event_registration_contacts), with its arguments
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const query = (rows: Row[]) => ({
    eq: (column: string, value: unknown) => query(rows.filter((row) => row[column] === value)),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (result: unknown) => void) => resolve({ data: rows, error: null }),
  });
  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) =>
          USER_IDS[token]
            ? { data: { user: { id: USER_IDS[token] } }, error: null }
            : { data: { user: null }, error: { message: "bad token" } },
      },
    },
    forUser: () => ({
      from: (table: string) => ({ select: () => query(tables[table] ?? []) }),
      rpc: async (fn: string, args: unknown) => {
        rpcCalls.push({ fn, args });
        if (fn !== "event_registration_contacts") throw new Error(`fake has no function ${fn}`);
        return contactsError ? { data: null, error: contactsError } : { data: contacts, error: null };
      },
    }),
  } as unknown as SupabaseDeps;
  return Object.assign(deps, { rpcCalls });
}
// end of fake Supabase

// ---------------------------------------------------------------------------
// SCRUM-74 — The events an organiser or coordinator manages (GET /events/managed)
// ---------------------------------------------------------------------------
describe("SCRUM-74 — Events I manage (GET /events/managed)", () => {
  // AC1: a coordinator sees only the events assigned to them, never another coordinator's
  it("SCRUM-74/AC1 lists only the events assigned to the calling coordinator", async () => {
    const deps = createFake({
      events: [eventRow(), eventRow({ id: "evt-2", name: "Other Summit", assigned_coordinator_id: "coordinator-2" })],
    });

    const res = await request(createApp(deps)).get("/events/managed").set("Cookie", COORDINATOR);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "evt-1", name: "Tech Summit", status: "confirmed", start_at: "2026-11-20T01:00:00Z", registration_capacity: 100 },
    ]);
  });

  // AC1: only organisers and coordinators can view registration information; anyone else is refused
  it("SCRUM-74/AC1 refuses a caller who is neither an organiser nor a coordinator", async () => {
    const deps = createFake({ events: [eventRow({ assigned_coordinator_id: "attendee-1" })] });

    const res = await request(createApp(deps)).get("/events/managed").set("Cookie", ATTENDEE);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Only event organisers and coordinators can view registrations." });
  });
  // end of AC1

  // AC2: an organiser has the same access as a coordinator: the events they organise, in the same shape
  it("SCRUM-74/AC2 lists only the events the calling organiser organises", async () => {
    const deps = createFake({
      events: [
        eventRow({ assigned_coordinator_id: null }),
        eventRow({ id: "evt-2", name: "Other Summit", organiser_id: "organiser-2" }),
      ],
    });

    const res = await request(createApp(deps)).get("/events/managed").set("Cookie", ORGANISER);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "evt-1", name: "Tech Summit", status: "confirmed", start_at: "2026-11-20T01:00:00Z", registration_capacity: 100 },
    ]);
  });
  // end of AC2
});
// end of SCRUM-74

// ---------------------------------------------------------------------------
// SCRUM-74 — One event's registrations (GET /events/:id/registrations)
// ---------------------------------------------------------------------------
describe("SCRUM-74 — Event registrations (GET /events/:id/registrations)", () => {
  /** One event_registrations row for evt-1, registered at `registeredAt` by the attendee named `name`. */
  const registrationRow = (id: string, name: string, registeredAt: string): Row => ({
    id,
    event_id: "evt-1",
    status: "registered",
    registered_at: registeredAt,
    registration_details: { name, email: `${id}@example.com`, phone: "+65 9123 4567" },
  });

  // AC8: the newest registration comes first, whatever order the database returns them in
  it("SCRUM-74/AC8 lists the newest registration first", async () => {
    const deps = createFake({
      registrations: [
        registrationRow("reg-1", "Oldest", "2026-10-01T02:00:00Z"),
        registrationRow("reg-2", "Newest", "2026-10-03T02:00:00Z"),
        registrationRow("reg-3", "Middle", "2026-10-02T02:00:00Z"),
      ],
    });

    const res = await request(createApp(deps)).get("/events/evt-1/registrations").set("Cookie", COORDINATOR);

    expect(res.body.map((r: { name: string }) => r.name)).toEqual(["Newest", "Middle", "Oldest"]);
  });
  // end of AC8

  // AC5: registrations made before the form existed (SCRUM-83) have no form details, so the attendee's name,
  // email and contact number come from their profile instead
  it("SCRUM-74/AC5 shows the attendee's profile details when a registration has no form details", async () => {
    const deps = createFake({
      registrations: [{ ...registrationRow("reg-1", "unused", "2026-10-01T02:00:00Z"), registration_details: null }],
      // SCRUM-154: the profile now comes from event_registration_contacts(), not from an embed of users
      contacts: [
        {
          registration_id: "reg-1",
          attendee_id: "attendee-1",
          full_name: "Daniel Ong",
          email: "daniel.ong@example.com",
          phone: "+65 9876 5432",
        },
      ],
    });

    const res = await request(createApp(deps)).get("/events/evt-1/registrations").set("Cookie", COORDINATOR);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ name: "Daniel Ong", email: "daniel.ong@example.com", phone: "+65 9876 5432" });
  });
  // end of AC5

  // SCRUM-154/AC3: attendee contact details come from the database function that checks the caller manages the event
  it("SCRUM-154/AC3 (154-S8) asks event_registration_contacts for this event's contacts", async () => {
    const deps = createFake({ registrations: [registrationRow("reg-1", "Daniel Ong", "2026-10-01T02:00:00Z")] });

    const res = await request(createApp(deps)).get("/events/evt-1/registrations").set("Cookie", COORDINATOR);

    expect(res.status).toBe(200);
    expect(deps.rpcCalls).toEqual([{ fn: "event_registration_contacts", args: { p_event_id: "evt-1" } }]);
  });

  // SCRUM-154/AC4: for someone who doesn't manage the event the function returns nothing, so the list keeps what the
  // attendee typed on the form and shows no profile contact details
  it("SCRUM-154/AC4 (154-S8) shows no profile details when the function returns none", async () => {
    const deps = createFake({
      registrations: [{ ...registrationRow("reg-1", "unused", "2026-10-01T02:00:00Z"), registration_details: null }],
      contacts: [],
    });

    const res = await request(createApp(deps)).get("/events/evt-1/registrations").set("Cookie", COORDINATOR);

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ name: null, email: null, phone: null });
  });

  // an empty contact list must not look like "no profile" when the lookup failed
  it("SCRUM-154/AC3 (154-S8) is an error, not a half-filled list, when the contacts lookup fails", async () => {
    const deps = createFake({
      registrations: [registrationRow("reg-1", "Daniel Ong", "2026-10-01T02:00:00Z")],
      contactsError: { message: "db down" },
    });

    const res = await request(createApp(deps)).get("/events/evt-1/registrations").set("Cookie", COORDINATOR);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't load this event's registrations. Please try again." });
  });
});
// end of SCRUM-74
