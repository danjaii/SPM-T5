import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fake Supabase (in memory) so tests never touch the real database
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function createFake() {
  const sessions = new Map<string, string>(); // login token -> user id
  const tables: Record<string, Row[]> = { users: [], events: [], event_status_history: [] };
  const rpcCalls: { fn: string; args: Row }[] = []; // every database function the route called, and with what
  const failure = { createEventRequest: false }; // set to true to make create_event_request fail, like a database error

  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
      maybeSingle: async () => {
        const rows = tables[table].filter((r) => filters.every(([col, val]) => r[col] === val));
        return { data: rows[0] ? { ...rows[0] } : null, error: null }; // a copy, like a real database sends
      },
    };
    return builder;
  };

  /**
   * Pretends to be the create_event_request database function (new migration for SCRUM-49).
   * Like the real one: the organiser is auth.uid() (the caller's token), and their organisation
   * is looked up from the users table. Neither comes from the arguments.
   */
  const createEventRequest = (callerId: string | undefined, args: Row) => {
    const caller = tables.users.find((u) => u.id === callerId);
    const event: Row = {
      id: crypto.randomUUID(),
      name: args.p_name,
      purpose: args.p_purpose,
      description: args.p_description,
      preferred_start_datetime: args.p_preferred_start_datetime,
      preferred_end_datetime: args.p_preferred_end_datetime,
      expected_attendance: args.p_expected_attendance,
      venue_requirements: args.p_venue_requirements,
      preferred_room_layout_id: args.p_preferred_room_layout_id,
      accessibility_requirements: args.p_accessibility_requirements,
      equipment_requirements_notes: args.p_equipment_requirements_notes,
      registration_required: args.p_registration_required,
      registration_capacity: args.p_registration_capacity ?? null,
      registration_opens_at: args.p_registration_opens_at ?? null,
      registration_closes_at: args.p_registration_closes_at ?? null,
      organiser_id: callerId,
      client_organisation_id: caller?.organisation_id ?? null,
      status: "submitted",
      is_draft: false,
      submitted_at: new Date().toISOString(),
    };
    tables.events.push(event);
    tables.event_status_history.push({ event_id: event.id, old_status: null, new_status: "submitted", changed_by: callerId });
    return { data: { ...event }, error: null };
  };

  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) => {
          const id = sessions.get(token);
          return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "bad token" } };
        },
      },
    },
    forUser: (token: string) => ({
      from: (table: string) => query(table),
      rpc: (fn: string, args: Row) => {
        const run = async () => {
          rpcCalls.push({ fn, args });
          if (fn !== "create_event_request") throw new Error(`fake has no function ${fn}`);
          if (failure.createEventRequest) return { data: null, error: { message: "database error" } }; // nothing is written
          return createEventRequest(sessions.get(token), args); // like auth.uid(): the caller comes from their token
        };
        return { single: run, maybeSingle: run };
      },
    }),
  } as unknown as SupabaseDeps;

  /** Pretends a user with this role is logged in; returns the cookie their browser would send. */
  const signIn = (role: string, extra: Row = {}) => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: "Test User", is_active: true, organisation_id: null, ...extra });
    sessions.set(`token-${id}`, id);
    return { id, cookie: `cs_session=token-${id}` };
  };

  return { deps, tables, rpcCalls, failure, signIn };
}
// end of fake Supabase

// A room layout id from supabase/seed.sql ("Theatre")
const THEATRE_LAYOUT_ID = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days: number, hour = 9) => {
  const d = new Date(Date.now() + days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

/** A complete, valid request: every AC1 field filled in, with attendee registration needed. */
function validRequest(): Row {
  return {
    name: "Tech Summit 2026",
    purpose: "Annual showcase of member companies' products",
    description: "A one-day summit with keynotes and product demos.",
    preferred_start_datetime: inDays(60, 9),
    preferred_end_datetime: inDays(60, 17),
    expected_attendance: 250,
    venue_requirements: "Central location near an MRT station, with a stage",
    preferred_room_layout_id: THEATRE_LAYOUT_ID,
    accessibility_requirements: "Wheelchair access to the stage",
    equipment_requirements_notes: "2 wireless microphones, 1 projector",
    registration_required: true,
    registration_capacity: 250,
    registration_opens_at: inDays(10),
    registration_closes_at: inDays(55),
  };
}

// ---------------------------------------------------------------------------
// SCRUM-49 — Create and Submit a New Event Request
// ---------------------------------------------------------------------------
describe("SCRUM-49/AC1 — Capture required fields", () => {
  it("stores every AC1 field against the new request", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const body = validRequest();

    const res = await request(createApp(fake.deps)).post("/events").set("Cookie", organiser.cookie).send(body);

    expect(res.status).toBe(201);
    expect(fake.tables.events).toHaveLength(1);
    expect(fake.tables.events[0]).toMatchObject(body);
  });

  it("returns the id of the new request", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await request(createApp(fake.deps)).post("/events").set("Cookie", organiser.cookie).send(validRequest());

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(fake.tables.events[0].id);
  });

  it('accepts "None required" for accessibility needs and equipment requirements', async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const body = { ...validRequest(), accessibility_requirements: "None required", equipment_requirements_notes: "None required" };

    const res = await request(createApp(fake.deps)).post("/events").set("Cookie", organiser.cookie).send(body);

    expect(res.status).toBe(201);
    expect(fake.tables.events[0]).toMatchObject({
      accessibility_requirements: "None required",
      equipment_requirements_notes: "None required",
    });
  });

  it("stores a request that needs no attendee registration, with no capacity or registration window", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const { registration_capacity, registration_opens_at, registration_closes_at, ...rest } = validRequest();
    const body = { ...rest, registration_required: false };

    const res = await request(createApp(fake.deps)).post("/events").set("Cookie", organiser.cookie).send(body);

    expect(res.status).toBe(201);
    expect(fake.tables.events[0]).toMatchObject({
      registration_required: false,
      registration_capacity: null,
      registration_opens_at: null,
      registration_closes_at: null,
    });
  });

  it("returns 500 and stores nothing when the database function fails", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    fake.failure.createEventRequest = true;

    const res = await request(createApp(fake.deps)).post("/events").set("Cookie", organiser.cookie).send(validRequest());

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Could not create the event request." });
    expect(fake.tables.events).toHaveLength(0);
    expect(fake.tables.event_status_history).toHaveLength(0);
  });
});
// end of AC1

describe("SCRUM-49/AC5 — Prevent incomplete submission", () => {
  const post = (fake: ReturnType<typeof createFake>, cookie: string, body: unknown) =>
    request(createApp(fake.deps)).post("/events").set("Cookie", cookie).send(body as object);

  it.each([
    "name",
    "purpose",
    "description",
    "preferred_start_datetime",
    "preferred_end_datetime",
    "expected_attendance",
    "venue_requirements",
    "preferred_room_layout_id",
    "accessibility_requirements",
    "equipment_requirements_notes",
    "registration_required",
  ])("refuses a request with no %s with 422 naming that field, and stores nothing", async (field) => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const body = validRequest();
    delete body[field];

    const res = await post(fake, organiser.cookie, body);

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(res.body.error).toBe("Check the highlighted fields."); // same shape as changeRequests.ts (SCRUM-66)
    expect(Object.keys(res.body.fieldErrors)).toEqual([field]);
    expect(typeof res.body.fieldErrors[field]).toBe("string");
    expect(fake.tables.events).toHaveLength(0);
    expect(fake.tables.event_status_history).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("lists every bad field together in the 422, and stores nothing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await post(fake, organiser.cookie, {
      ...validRequest(),
      name: "",
      expected_attendance: 0,
      preferred_end_datetime: validRequest().preferred_start_datetime,
    });

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["expected_attendance", "name", "preferred_end_datetime"]);
    expect(fake.tables.events).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("refuses a start in the past with 422, and stores nothing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await post(fake, organiser.cookie, {
      ...validRequest(),
      preferred_start_datetime: inDays(-2, 9),
      preferred_end_datetime: inDays(-2, 17),
      registration_required: false,
    });

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["preferred_start_datetime"]);
    expect(fake.tables.events).toHaveLength(0);
  });

  it("refuses registration with no capacity or window with 422 naming all three, and stores nothing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const { registration_capacity, registration_opens_at, registration_closes_at, ...rest } = validRequest();

    const res = await post(fake, organiser.cookie, rest);

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["registration_capacity", "registration_closes_at", "registration_opens_at"]);
    expect(fake.tables.events).toHaveLength(0);
  });

  it("refuses a window that closes after the event starts with 422, and stores nothing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await post(fake, organiser.cookie, { ...validRequest(), registration_closes_at: inDays(61, 9) });

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["registration_closes_at"]);
    expect(fake.tables.events).toHaveLength(0);
  });

  it("refuses an empty body with 422, and stores nothing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await post(fake, organiser.cookie, {});

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors).length).toBeGreaterThanOrEqual(11);
    expect(fake.tables.events).toHaveLength(0);
  });

  it("checks the role before the fields: an attendee sending a bad request gets 403, not 422", async () => {
    const fake = createFake();
    const attendee = fake.signIn("attendee");

    const res = await post(fake, attendee.cookie, {});

    expect(res.status).toBe(403);
  });
});
// end of AC5

describe("SCRUM-49/AC6 — Confirmation of submission", () => {
  it("returns the date and time of submission in the 201 response", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const before = Date.now();

    const res = await request(createApp(fake.deps)).post("/events").set("Cookie", organiser.cookie).send(validRequest());

    expect(res.status).toBe(201);
    expect(typeof res.body.submitted_at).toBe("string");
    const submittedAt = new Date(res.body.submitted_at).getTime();
    expect(Number.isNaN(submittedAt)).toBe(false);
    expect(submittedAt).toBeGreaterThanOrEqual(before);
    expect(submittedAt).toBeLessThanOrEqual(Date.now());
    expect(res.body.submitted_at).toBe(fake.tables.events[0].submitted_at);
  });
});
// end of AC6

describe("SCRUM-49/AC7 — Record ownership", () => {
  it("records the signed-in organiser as the request's event organiser", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    await request(createApp(fake.deps)).post("/events").set("Cookie", organiser.cookie).send(validRequest());

    expect(fake.tables.events[0].organiser_id).toBe(organiser.id);
  });

  it("ignores an organiser_id sent in the request body", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const someoneElse = fake.signIn("event_organiser");

    const res = await request(createApp(fake.deps))
      .post("/events")
      .set("Cookie", organiser.cookie)
      .send({ ...validRequest(), organiser_id: someoneElse.id });

    expect(res.status).toBe(201);
    expect(fake.tables.events[0].organiser_id).toBe(organiser.id);
    // the organiser must never be passed to the database from the request; it comes from the login token
    expect(Object.keys(fake.rpcCalls[0].args).join(",")).not.toMatch(/organiser/);
  });

  it("records the organiser's own organisation as the client, ignoring one sent in the body", async () => {
    const fake = createFake();
    const ownOrg = crypto.randomUUID();
    const organiser = fake.signIn("event_organiser", { organisation_id: ownOrg });

    await request(createApp(fake.deps))
      .post("/events")
      .set("Cookie", organiser.cookie)
      .send({ ...validRequest(), client_organisation_id: crypto.randomUUID() });

    expect(fake.tables.events[0].client_organisation_id).toBe(ownOrg);
    expect(Object.keys(fake.rpcCalls[0].args).join(",")).not.toMatch(/organisation/);
  });

  it("refuses a request with no login with 401, and stores nothing", async () => {
    const fake = createFake();

    const res = await request(createApp(fake.deps)).post("/events").send(validRequest());

    expect(res.status).toBe(401);
    expect(fake.tables.events).toHaveLength(0);
  });

  // Decided with the PO: only event organisers create event requests
  it.each([
    "event_coordinator",
    "event_coordinator_lead",
    "venue_staff",
    "technical_support_staff",
    "safety_officer",
    "attendee",
  ])(
    "refuses a %s with 403, and stores nothing",
    async (role) => {
      const fake = createFake();
      const outsider = fake.signIn(role);

      const res = await request(createApp(fake.deps)).post("/events").set("Cookie", outsider.cookie).send(validRequest());

      expect(res.status).toBe(403);
      expect(fake.tables.events).toHaveLength(0);
      expect(fake.rpcCalls).toHaveLength(0);
    },
  );
});
// end of AC7
// end of SCRUM-49
