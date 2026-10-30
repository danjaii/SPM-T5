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
/** The cookie a signed-in event organiser's browser sends. */
const ORGANISER = "cs_session=token-organiser";
/** Who each login token belongs to. */
const USER_IDS: Record<string, string> = { "token-attendee": "attendee-1", "token-organiser": "organiser-1" };

/** What the attendee types into the registration form. */
const VALID_FORM = { name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "+65 9123 4567" };

/** The signed-in attendee's row in the users table (supabase/migrations/01_schema.sql). */
const PROFILE: Row = { full_name: "Alicia Fernandez", email: "alicia.fernandez@example.com", phone: "+65 9123 4567" };

/** When the registered event starts and ends: tomorrow, so it is upcoming (SCRUM-72/AC1) whenever the tests run. */
const EVENT_START = fromNow(24 * HOUR);
const EVENT_END = fromNow(26 * HOUR);

/**
 * One event_registrations row, as `select("…, event:events(…)")` returns it: the event comes embedded.
 * Belongs to attendee-1 for a Pending registration of evt-1 unless overridden.
 */
function registrationRow(overrides: Row = {}): Row {
  return {
    id: "reg-1",
    event_id: "evt-1",
    attendee_id: "attendee-1",
    status: "waitlisted",
    registered_at: "2026-10-01T02:00:00Z",
    registration_details: VALID_FORM,
    event: {
      id: "evt-1",
      name: "Tech Summit",
      status: "confirmed",
      preferred_start_datetime: EVENT_START,
      preferred_end_datetime: EVENT_END,
    },
    ...overrides,
  };
}

/**
 * Pretends to be Supabase: one signed-in attendee (attendee-1, whose users row is `profile`), and
 * list_public_events() answering with `events`. `registrations` are the event_registrations table's rows.
 * Every register_for_event() call is recorded in `registerCalls`, so a test can check what would have been saved; it answers
 * `registerStatus`, or fails with `registerError` the way supabase-js reports a refused call. decide_registration() is the same
 * (`decideCalls`, `decideError`).
 * Given `readError`, every table read fails with it the same way (no data, and an error object).
 * Every update is recorded in `updates` (which row, and the fields written). Given `updateRefused`, an update changes
 * no row, the way RLS silently filters out rows the caller may not update.
 */
function createFake(
  events: Row[],
  {
    registerError = null,
    registerStatus = "registered",
    decideError = null,
    readError = null,
    profile = PROFILE,
    registrations = [],
    updateRefused = false,
  }: {
    registerError?: { code: string; message: string } | null;
    registerStatus?: string;
    decideError?: { code: string; message: string } | null;
    readError?: { message: string } | null;
    profile?: Row;
    registrations?: Row[];
    updateRefused?: boolean;
  } = {},
) {
  // The tables a query can read. (The fake ignores the select() column list, so rows are stored already shaped.)
  const tables: Record<string, Row[]> = {
    users: [{ id: "attendee-1", ...profile }],
    event_registrations: registrations,
  };
  const registerCalls: Row[] = [];
  const decideCalls: Row[] = [];
  const updates: { table: string; id: unknown; fields: Row }[] = [];
  // A read of `rows`: each .eq() narrows them; then read as one row (maybeSingle) or as a list (await)
  const query = (rows: Row[]) => ({
    eq: (column: string, value: unknown) => query(rows.filter((row) => row[column] === value)),
    maybeSingle: async () => (readError ? { data: null, error: readError } : { data: rows[0] ?? null, error: null }),
    then: (resolve: (result: unknown) => void) =>
      resolve(readError ? { data: null, error: readError } : { data: rows, error: null }),
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
      from: (table: string) => ({
        // Reads: the rows of `table` matching every .eq(), either as one row (maybeSingle) or as a list (await)
        select: () => query(tables[table] ?? []),
        // Updates: each .eq() narrows the rows to change; .select() changes them and returns the changed rows
        update: (fields: Row) => {
          const narrow = (rows: Row[]) => ({
            eq: (column: string, value: unknown) => narrow(rows.filter((row) => row[column] === value)),
            select: async () => {
              const changed = updateRefused ? [] : rows;
              for (const row of changed) {
                Object.assign(row, fields);
                updates.push({ table, id: row.id, fields });
              }
              return { data: changed, error: null };
            },
          });
          return narrow(tables[table] ?? []);
        },
      }),
      rpc: async (fn: string, args: Row) => {
        // SCRUM-169: registering goes through register_for_event(), which answers with the status it saved
        if (fn === "register_for_event") {
          registerCalls.push(args);
          return registerError ? { data: null, error: registerError } : { data: registerStatus, error: null };
        }
        // SCRUM-169/AC3: the organiser's decision, answered with the status it saved
        if (fn === "decide_registration") {
          decideCalls.push(args);
          if (decideError) return { data: null, error: decideError };
          return { data: args.p_decision === "confirm" ? "registered" : "cancelled", error: null };
        }
        // SCRUM-154: the caller's own email and phone come from my_contact_details(), as a one-row table
        if (fn === "my_contact_details") {
          return { data: [{ email: profile.email, phone: profile.phone, communication_preferences: {} }], error: null };
        }
        // SCRUM-154: the registrants' profile details; these rows carry their form details, so no profile contact is needed
        if (fn === "event_registration_contacts") {
          return readError ? { data: null, error: readError } : { data: [], error: null };
        }
        if (fn !== "list_public_events") throw new Error(`fake has no function ${fn}`);
        return { data: events, error: null };
      },
    }),
  } as unknown as SupabaseDeps;
  return { deps, registerCalls, decideCalls, updates };
}
// end of fake Supabase

// ---------------------------------------------------------------------------
// SCRUM-83 — Register for an event (POST /events/:id/registrations)
// ---------------------------------------------------------------------------
describe("SCRUM-83 — Register for an event (POST /events/:id/registrations)", () => {
  // SCRUM-169/AC1 replaces SCRUM-83/AC12's "always Pending": with a free place the registration is Confirmed at once
  it("SCRUM-169/AC1 reports the registration as Confirmed when the database confirmed it", async () => {
    const fake = createFake([eventRow()]);

    const res = await request(createApp(fake.deps))
      .post("/events/evt-1/registrations")
      .set("Cookie", ATTENDEE)
      .send(VALID_FORM);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ event_name: "Tech Summit", status: "confirmed" });
    expect(fake.registerCalls).toEqual([{ p_event_id: "evt-1", p_details: VALID_FORM }]);
  });
  // end of AC1

  // AC10: a missing required field is refused with an error for that field, and nothing is created
  it("SCRUM-83/AC10 refuses a form with no contact number and creates no registration", async () => {
    const fake = createFake([eventRow()]);

    const res = await request(createApp(fake.deps))
      .post("/events/evt-1/registrations")
      .set("Cookie", ATTENDEE)
      .send({ ...VALID_FORM, phone: "" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ errors: { phone: "Contact number is required." } });
    expect(fake.registerCalls).toEqual([]);
  });
  // end of AC10

  // AC11: the email must be in a valid format
  it("SCRUM-83/AC11 refuses a badly formatted email and creates no registration", async () => {
    const fake = createFake([eventRow()]);

    const res = await request(createApp(fake.deps))
      .post("/events/evt-1/registrations")
      .set("Cookie", ATTENDEE)
      .send({ ...VALID_FORM, email: "alicia.example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ errors: { email: "Enter a valid email address." } });
    expect(fake.registerCalls).toEqual([]);
  });

  // AC11: the contact number must be in a valid format: an optional +, then 8 to 15 digits (spaces and hyphens allowed)
  it("SCRUM-83/AC11 refuses a badly formatted contact number and creates no registration", async () => {
    const fake = createFake([eventRow()]);

    const res = await request(createApp(fake.deps))
      .post("/events/evt-1/registrations")
      .set("Cookie", ATTENDEE)
      .send({ ...VALID_FORM, phone: "9123-abcd" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ errors: { phone: "Enter a valid contact number." } });
    expect(fake.registerCalls).toEqual([]);
  });
  // end of AC11

  // AC3: with a registration deadline, registration closes at the deadline
  it("SCRUM-83/AC3 refuses a registration once the registration deadline has passed", async () => {
    const fake = createFake([eventRow({ registration_closes_at: fromNow(-1 * HOUR) })]);

    const res = await request(createApp(fake.deps))
      .post("/events/evt-1/registrations")
      .set("Cookie", ATTENDEE)
      .send(VALID_FORM);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Registration closed." });
    expect(fake.registerCalls).toEqual([]);
  });

  // AC3: with no registration deadline, registration closes when the event starts
  it("SCRUM-83/AC3 refuses a registration once an event with no deadline has started", async () => {
    const started = eventRow({ registration_closes_at: null, start_at: fromNow(-1 * HOUR), end_at: fromNow(1 * HOUR) });
    const fake = createFake([started]);

    const res = await request(createApp(fake.deps))
      .post("/events/evt-1/registrations")
      .set("Cookie", ATTENDEE)
      .send(VALID_FORM);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Registration closed." });
    expect(fake.registerCalls).toEqual([]);
  });
  // end of AC3

  // SCRUM-169/AC2 replaces SCRUM-83/AC4's refusal: a full event still takes the registration, as Pending
  it("SCRUM-169/AC2 saves a registration on a full event and reports it as Pending", async () => {
    const fake = createFake([eventRow({ registration_capacity: 50, active_registrations: 50 })], { registerStatus: "waitlisted" });

    const res = await request(createApp(fake.deps))
      .post("/events/evt-1/registrations")
      .set("Cookie", ATTENDEE)
      .send(VALID_FORM);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ event_name: "Tech Summit", status: "pending" });
    expect(fake.registerCalls).toHaveLength(1);
  });

  // SCRUM-169/AC2: the "Event Full" label outranks "Registration Closed" (SCRUM-71/AC7), but a closed window still refuses
  it("SCRUM-169/AC2 refuses a registration on a full event whose registration has closed", async () => {
    const fake = createFake([
      eventRow({ registration_capacity: 50, active_registrations: 50, registration_closes_at: fromNow(-1 * HOUR) }),
    ]);

    const res = await request(createApp(fake.deps))
      .post("/events/evt-1/registrations")
      .set("Cookie", ATTENDEE)
      .send(VALID_FORM);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Registration closed." });
    expect(fake.registerCalls).toEqual([]);
  });

  // SCRUM-169/AC1: registration closed or the event was cancelled after the check above: the database's refusal, in the same words
  it("SCRUM-169/AC1 reports the database's refusal when registration closed during the submit", async () => {
    const fake = createFake([eventRow()], { registerError: { code: "CS169", message: "REGISTRATION_CLOSED" } });

    const res = await request(createApp(fake.deps))
      .post("/events/evt-1/registrations")
      .set("Cookie", ATTENDEE)
      .send(VALID_FORM);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Registration closed." });
  });

  // AC17: the event was cancelled after the attendee opened the form, so the submission is refused.
  // (The full and closed cases of AC17 are the AC3 and AC4 tests: those are checked at submit time too.)
  // "The profile isn't changed": the fake has no update(), so any attempt to change a profile would fail this test.
  it("SCRUM-83/AC17 refuses a registration for an event cancelled while the form was open", async () => {
    const fake = createFake([eventRow({ status: "cancelled" })]);

    const res = await request(createApp(fake.deps))
      .post("/events/evt-1/registrations")
      .set("Cookie", ATTENDEE)
      .send(VALID_FORM);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "This event has been cancelled." });
    expect(fake.registerCalls).toEqual([]);
  });
  // end of AC17

  // AC5: only one active registration (Pending = waitlisted, Confirmed = registered) per attendee per event
  it.each(["waitlisted", "registered"])(
    "SCRUM-83/AC5 refuses a second registration while the attendee's one is %s",
    async (myStatus) => {
      const fake = createFake([eventRow({ my_registration_status: myStatus })]);

      const res = await request(createApp(fake.deps))
        .post("/events/evt-1/registrations")
        .set("Cookie", ATTENDEE)
        .send(VALID_FORM);

      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: "You already have an active registration for this event." });
      expect(fake.registerCalls).toEqual([]);
    },
  );
  // end of AC5

  // AC6: a Withdrawn or Rejected (stored as 'cancelled') registration isn't active, so the attendee can register again,
  // and that creates a new registration (the database keeps the earlier one: see the integration tests)
  it.each(["withdrawn", "cancelled"])(
    "SCRUM-83/AC6 lets an attendee register again after their registration was %s",
    async (previousStatus) => {
      const fake = createFake([eventRow({ my_registration_status: previousStatus })]);

      const res = await request(createApp(fake.deps))
        .post("/events/evt-1/registrations")
        .set("Cookie", ATTENDEE)
        .send(VALID_FORM);

      expect(res.status).toBe(201);
      expect(fake.registerCalls).toHaveLength(1);
    },
  );
  // end of AC6

  // AC16: a repeated submit (e.g. a double-click) creates only one registration. Two requests at the same moment
  // both pass the AC5 check, so the database's one-active-registration rule refuses the second insert (23505);
  // the attendee must get the AC5 message, not a server error or a false success.
  it("SCRUM-83/AC16 refuses a repeated submit that the database turned away as a duplicate", async () => {
    const duplicate = { code: "23505", message: "duplicate key value violates unique constraint" };
    const fake = createFake([eventRow()], { registerError: duplicate });

    const res = await request(createApp(fake.deps))
      .post("/events/evt-1/registrations")
      .set("Cookie", ATTENDEE)
      .send(VALID_FORM);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "You already have an active registration for this event." });
  });
  // end of AC16

  // AC12: only a registration that was really saved is reported as Pending; any other database failure is an error
  it("SCRUM-83/AC12 reports an error, not a Pending registration, when the database fails to save it", async () => {
    const outage = { code: "08006", message: "connection failure" };
    const fake = createFake([eventRow()], { registerError: outage });

    const res = await request(createApp(fake.deps))
      .post("/events/evt-1/registrations")
      .set("Cookie", ATTENDEE)
      .send(VALID_FORM);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't save your registration. Please try again." });
  });

  // AC12: a registration is only created for an event listed for attendees (unknown id, or not a public event: 404)
  it("SCRUM-83/AC12 refuses to register for an event that isn't listed for attendees", async () => {
    const fake = createFake([eventRow({ id: "evt-1" })]);

    const res = await request(createApp(fake.deps))
      .post("/events/evt-unknown/registrations")
      .set("Cookie", ATTENDEE)
      .send(VALID_FORM);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Event not found." });
    expect(fake.registerCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-169 — The organiser's decision (POST /events/:id/registrations/:registrationId/decision)
// ---------------------------------------------------------------------------
describe("SCRUM-169 — The organiser confirms or declines a Pending registration", () => {
  const decide = (fake: ReturnType<typeof createFake>, body: Row) =>
    request(createApp(fake.deps)).post("/events/evt-1/registrations/reg-1/decision").set("Cookie", ORGANISER).send(body);

  it("SCRUM-169/AC3 confirms a Pending registration", async () => {
    const fake = createFake([]);

    const res = await decide(fake, { decision: "confirm" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "confirmed" });
    expect(fake.decideCalls).toEqual([{ p_registration_id: "reg-1", p_decision: "confirm" }]);
  });

  it("SCRUM-169/AC3 declines a Pending registration, which shows as Rejected", async () => {
    const fake = createFake([]);

    const res = await decide(fake, { decision: "decline" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "rejected" });
  });

  it("SCRUM-169/AC3 refuses a decision that is neither confirm nor decline, before asking the database", async () => {
    const fake = createFake([]);

    const res = await decide(fake, { decision: "maybe" });

    expect(res.status).toBe(400);
    expect(fake.decideCalls).toEqual([]);
  });

  it("SCRUM-169/AC3 answers not found for someone who isn't the event's organiser", async () => {
    const fake = createFake([], { decideError: { code: "CS169", message: "NOT_FOUND" } });

    const res = await decide(fake, { decision: "confirm" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Registration not found." });
  });

  // AC4: a full event refuses, and the message says what would allow it
  it.each([
    ["EVENT_FULL", "This event is full. A place must be freed before you can confirm this registration."],
    ["NOT_PENDING", "This registration is no longer Pending."],
    ["EVENT_CLOSED", "This event is no longer taking registrations."],
  ])("SCRUM-169/AC4 explains a %s refusal", async (code, message) => {
    const fake = createFake([], { decideError: { code: "CS169", message: code } });

    const res = await decide(fake, { decision: "confirm" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: message });
  });

  it("SCRUM-169/AC3 reports an error when the database fails", async () => {
    const fake = createFake([], { decideError: { code: "08006", message: "connection failure" } });

    const res = await decide(fake, { decision: "confirm" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't save your decision. Please try again." });
  });
});

// ---------------------------------------------------------------------------
// SCRUM-83 — The registration form's data (GET /events/:id/registration-form)
// ---------------------------------------------------------------------------
describe("SCRUM-83 — Registration form data (GET /events/:id/registration-form)", () => {
  // AC7: the form shows the event's name, date and time, and location
  it("SCRUM-83/AC7 returns the event's name, start and end time, and venue", async () => {
    const row = eventRow();
    const fake = createFake([row]);

    const res = await request(createApp(fake.deps)).get("/events/evt-1/registration-form").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({
      id: "evt-1",
      name: "Tech Summit",
      start_at: row.start_at,
      end_at: row.end_at,
      venue: { name: "Orchid Hall", address: "Level 3, East Wing" },
    });
  });

  // AC7: no form for an event that isn't listed for attendees (unknown id, or not a public event)
  it("SCRUM-83/AC7 answers 404 for an event that isn't listed for attendees", async () => {
    const fake = createFake([eventRow({ id: "evt-1" })]);

    const res = await request(createApp(fake.deps)).get("/events/evt-unknown/registration-form").set("Cookie", ATTENDEE);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Event not found." });
  });
  // end of AC7

  // AC8: name, contact number and email come prefilled from the attendee's account and profile
  it("SCRUM-83/AC8 prefills name, email and contact number from the attendee's profile", async () => {
    const fake = createFake([eventRow()]);

    const res = await request(createApp(fake.deps)).get("/events/evt-1/registration-form").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(res.body.prefill).toEqual({
      name: "Alicia Fernandez",
      email: "alicia.fernandez@example.com",
      phone: "+65 9123 4567",
    });
  });
  // end of AC8

  // AC9: no contact number in the profile means an empty field (the attendee must fill it in: see AC10)
  it("SCRUM-83/AC9 prefills an empty contact number when the profile has none", async () => {
    const fake = createFake([eventRow()], { profile: { ...PROFILE, phone: null } });

    const res = await request(createApp(fake.deps)).get("/events/evt-1/registration-form").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(res.body.prefill.phone).toBe("");
  });
  // end of AC9

  // SCRUM-154/AC1: the attendee's own email and phone are no longer readable from users, so they come through the
  // database function that returns the caller's own details (154-S9)
  it("SCRUM-154/AC5 (154-S9) reads the attendee's own email and phone through my_contact_details()", async () => {
    const fake = createFake([eventRow()], { profile: { ...PROFILE, email: "from-function@example.com", phone: "+65 1111 2222" } });

    const res = await request(createApp(fake.deps)).get("/events/evt-1/registration-form").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(res.body.prefill).toEqual({
      name: "Alicia Fernandez",
      email: "from-function@example.com",
      phone: "+65 1111 2222",
    });
  });
});

// ---------------------------------------------------------------------------
// SCRUM-83 — The attendee's "My registrations" (GET /events/my-registrations)
// ---------------------------------------------------------------------------
describe("SCRUM-83 — My registrations (GET /events/my-registrations)", () => {
  // AC15: the new registration appears on the attendee's "My registrations" page.
  // AC6: earlier (Withdrawn/Rejected) registrations stay in the history, so they're listed too.
  it("SCRUM-83/AC15 lists the attendee's own registrations, earlier ones included", async () => {
    const withdrawn = registrationRow({ id: "reg-old", status: "withdrawn", registered_at: "2026-09-01T02:00:00Z" });
    const pending = registrationRow({ id: "reg-new", status: "waitlisted", registered_at: "2026-10-01T02:00:00Z" });
    const someoneElses = registrationRow({ id: "reg-other", attendee_id: "attendee-2" });
    const fake = createFake([], { registrations: [withdrawn, pending, someoneElses] });

    const res = await request(createApp(fake.deps)).get("/events/my-registrations").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    // SCRUM-72/AC4: the event now carries its location; this fake lists no public events, so the venue is unknown
    const event = {
      id: "evt-1",
      name: "Tech Summit",
      start_at: EVENT_START,
      end_at: EVENT_END,
      venue: { name: null, address: null },
    };
    expect(res.body).toHaveLength(2);
    expect(res.body).toEqual(
      expect.arrayContaining([
        // SCRUM-73/AC2: each also says whether it can be withdrawn
        { id: "reg-old", status: "withdrawn", registered_at: "2026-09-01T02:00:00Z", event, can_withdraw: false },
        { id: "reg-new", status: "pending", registered_at: "2026-10-01T02:00:00Z", event, can_withdraw: true },
      ]),
    );
  });

  // AC15: an empty list must mean there are none, so a failed database call is an error (as in SCRUM-71/AC11)
  it("SCRUM-83/AC15 reports an error, not an empty list, when loading registrations fails", async () => {
    const fake = createFake([], { registrations: [registrationRow()], readError: { message: "connection failure" } });

    const res = await request(createApp(fake.deps)).get("/events/my-registrations").set("Cookie", ATTENDEE);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't load your registrations. Please try again." });
  });
  // end of AC15
});

// ---------------------------------------------------------------------------
// SCRUM-72 — The attendee views the status of their registrations (GET /events/my-registrations)
// ---------------------------------------------------------------------------
describe("SCRUM-72 — View the status of my registrations (GET /events/my-registrations)", () => {
  // AC1: "My registrations" lists the upcoming events the attendee registered for, so an event that has
  // already started is left out
  it("SCRUM-72/AC1 lists only registrations for events that haven't started yet", async () => {
    const started = registrationRow({
      id: "reg-past",
      event: {
        id: "evt-past",
        name: "Last Week's Meetup",
        preferred_start_datetime: fromNow(-2 * HOUR),
        preferred_end_datetime: fromNow(-1 * HOUR),
      },
    });
    const upcoming = registrationRow({
      id: "reg-next",
      event: {
        id: "evt-1",
        name: "Tech Summit",
        preferred_start_datetime: fromNow(24 * HOUR),
        preferred_end_datetime: fromNow(26 * HOUR),
      },
    });
    const fake = createFake([], { registrations: [started, upcoming] });

    const res = await request(createApp(fake.deps)).get("/events/my-registrations").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: string }) => r.id)).toEqual(["reg-next"]);
  });
  // end of AC1

  // AC2: an attendee sees only their own registrations, never another attendee's.
  // The database enforces the same with RLS (tests/integration/event-registration-db.test.ts, SCRUM-83/AC15).
  it("SCRUM-72/AC2 never lists another attendee's registration", async () => {
    const mine = registrationRow({ id: "reg-mine" });
    const someoneElses = registrationRow({ id: "reg-other", attendee_id: "attendee-2" });
    const fake = createFake([], { registrations: [mine, someoneElses] });

    const res = await request(createApp(fake.deps)).get("/events/my-registrations").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: string }) => r.id)).toEqual(["reg-mine"]);
  });
  // end of AC2

  // AC4: each registration shows its event's location: the venue's name and address. They come from
  // list_public_events() (as on the List of events, SCRUM-71/AC3), since RLS doesn't let attendees read venue bookings.
  it("SCRUM-72/AC4 includes the location of each registration's event", async () => {
    const fake = createFake([eventRow()], { registrations: [registrationRow()] });

    const res = await request(createApp(fake.deps)).get("/events/my-registrations").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(res.body[0].event.venue).toEqual({ name: "Orchid Hall", address: "Level 3, East Wing" });
  });
  // end of AC4
});
// end of SCRUM-72

// ---------------------------------------------------------------------------
// SCRUM-83 — The event's registrations, for organisers and coordinators (GET /events/:id/registrations)
// Who may see them is RLS's job (supabase/migrations/11_event_registrations.sql), tested in tests/integration.
// ---------------------------------------------------------------------------
describe("SCRUM-83 — Event registrations (GET /events/:id/registrations)", () => {
  // AC15: the new registration appears on the registration information page seen by organisers and coordinators
  it("SCRUM-83/AC15 lists the event's registrations with each attendee's details and status", async () => {
    const alicia = registrationRow({ id: "reg-1", attendee_id: "attendee-1", status: "waitlisted" });
    const ben = registrationRow({
      id: "reg-2",
      attendee_id: "attendee-2",
      status: "registered",
      registered_at: "2026-10-02T02:00:00Z",
      registration_details: { name: "Ben Lim", email: "ben.lim@example.com", phone: "81234567" },
    });
    const otherEvent = registrationRow({ id: "reg-3", event_id: "evt-2" });
    const fake = createFake([], { registrations: [alicia, ben, otherEvent] });

    const res = await request(createApp(fake.deps)).get("/events/evt-1/registrations").set("Cookie", ORGANISER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body).toEqual(
      expect.arrayContaining([
        {
          id: "reg-1",
          status: "pending",
          registered_at: "2026-10-01T02:00:00Z",
          name: "Alicia Fernandez",
          email: "alicia.fernandez@example.com",
          phone: "+65 9123 4567",
        },
        {
          id: "reg-2",
          status: "confirmed",
          registered_at: "2026-10-02T02:00:00Z",
          name: "Ben Lim",
          email: "ben.lim@example.com",
          phone: "81234567",
        },
      ]),
    );
  });

  // AC15: an empty list must mean nobody has registered, so a failed database call is an error
  it("SCRUM-83/AC15 reports an error, not an empty list, when loading the event's registrations fails", async () => {
    const fake = createFake([], { registrations: [registrationRow()], readError: { message: "connection failure" } });

    const res = await request(createApp(fake.deps)).get("/events/evt-1/registrations").set("Cookie", ORGANISER);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't load this event's registrations. Please try again." });
  });
  // end of AC15
});
// end of SCRUM-83

// ---------------------------------------------------------------------------
// SCRUM-73 — Withdraw from an event (POST /events/my-registrations/:id/withdraw)
// ---------------------------------------------------------------------------
describe("SCRUM-73 — Withdraw from an event (POST /events/my-registrations/:id/withdraw)", () => {
  // AC6: after the attendee confirms, their registration's status becomes Withdrawn
  it("SCRUM-73/AC6 changes the attendee's own Pending registration to Withdrawn", async () => {
    const fake = createFake([], { registrations: [registrationRow({ id: "reg-1", status: "waitlisted" })] });

    const res = await request(createApp(fake.deps)).post("/events/my-registrations/reg-1/withdraw").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "withdrawn" });
    expect(fake.updates).toEqual([
      { table: "event_registrations", id: "reg-1", fields: { status: "withdrawn", withdrawn_at: expect.any(String) } },
    ]);
    // withdrawn_at is when it happened: just now
    expect(Date.now() - Date.parse(fake.updates[0].fields.withdrawn_at as string)).toBeLessThan(60_000);
  });

  // AC6: the database (RLS) refuses an update by changing no row rather than with an error, so "no row changed"
  // must not be reported as a withdrawal
  it("SCRUM-73/AC6 doesn't report a withdrawal the database refused", async () => {
    const fake = createFake([], { registrations: [registrationRow({ id: "reg-1" })], updateRefused: true });

    const res = await request(createApp(fake.deps)).post("/events/my-registrations/reg-1/withdraw").set("Cookie", ATTENDEE);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "This registration can no longer be withdrawn." });
  });
  // end of AC6

  // AC1: an attendee can withdraw only their own registration, never another attendee's.
  // The database refuses it too (tests/integration/event-registration-db.test.ts).
  it("SCRUM-73/AC1 refuses to withdraw another attendee's registration, changing nothing", async () => {
    const fake = createFake([], { registrations: [registrationRow({ id: "reg-2", attendee_id: "attendee-2" })] });

    const res = await request(createApp(fake.deps)).post("/events/my-registrations/reg-2/withdraw").set("Cookie", ATTENDEE);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Registration not found." });
    expect(fake.updates).toEqual([]);
  });
  // end of AC1

  // AC2: only a Pending or Confirmed registration can be withdrawn; a Rejected one (stored as 'cancelled') can't
  it("SCRUM-73/AC2 refuses to withdraw a Rejected registration, changing nothing", async () => {
    const fake = createFake([], { registrations: [registrationRow({ id: "reg-1", status: "cancelled" })] });

    const res = await request(createApp(fake.deps)).post("/events/my-registrations/reg-1/withdraw").set("Cookie", ATTENDEE);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Only a Pending or Confirmed registration can be withdrawn." });
    expect(fake.updates).toEqual([]);
  });

  // AC2: a Confirmed registration (stored as 'registered') can be withdrawn, not just a Pending one
  it("SCRUM-73/AC2 withdraws a Confirmed registration", async () => {
    const fake = createFake([], { registrations: [registrationRow({ id: "reg-1", status: "registered" })] });

    const res = await request(createApp(fake.deps)).post("/events/my-registrations/reg-1/withdraw").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(fake.updates.map((u) => u.fields.status)).toEqual(["withdrawn"]);
  });
  // end of AC2

  // AC5: no withdrawing once the event has started (an event that has ended has started too)
  it("SCRUM-73/AC5 refuses to withdraw from an event that has already started, changing nothing", async () => {
    const started = registrationRow({
      id: "reg-1",
      event: {
        id: "evt-1",
        name: "Tech Summit",
        status: "confirmed",
        preferred_start_datetime: fromNow(-1 * HOUR),
        preferred_end_datetime: fromNow(1 * HOUR),
      },
    });
    const fake = createFake([], { registrations: [started] });

    const res = await request(createApp(fake.deps)).post("/events/my-registrations/reg-1/withdraw").set("Cookie", ATTENDEE);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "This event has already started." });
    expect(fake.updates).toEqual([]);
  });

  // AC5: no withdrawing from a cancelled event, even one whose date is still ahead
  it("SCRUM-73/AC5 refuses to withdraw from a cancelled event, changing nothing", async () => {
    const cancelled = registrationRow({
      id: "reg-1",
      event: {
        id: "evt-1",
        name: "Tech Summit",
        status: "cancelled",
        preferred_start_datetime: EVENT_START,
        preferred_end_datetime: EVENT_END,
      },
    });
    const fake = createFake([], { registrations: [cancelled] });

    const res = await request(createApp(fake.deps)).post("/events/my-registrations/reg-1/withdraw").set("Cookie", ATTENDEE);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "This event has been cancelled." });
    expect(fake.updates).toEqual([]);
  });
  // end of AC5

  // AC2, AC5: "My registrations" says which registrations can be withdrawn, by the same rules as the route above,
  // so the page can disable the Withdraw button (AC5) or leave it out (AC2)
  it("SCRUM-73/AC2,AC5 says on My registrations which registrations can be withdrawn", async () => {
    const open = registrationRow({ id: "reg-open", status: "waitlisted" });
    const cancelledEvent = registrationRow({
      id: "reg-cancelled-event",
      status: "registered",
      event: {
        id: "evt-2",
        name: "Design Day",
        status: "cancelled",
        preferred_start_datetime: EVENT_START,
        preferred_end_datetime: EVENT_END,
      },
    });
    const withdrawn = registrationRow({ id: "reg-withdrawn", status: "withdrawn" });
    const fake = createFake([], { registrations: [open, cancelledEvent, withdrawn] });

    const res = await request(createApp(fake.deps)).get("/events/my-registrations").set("Cookie", ATTENDEE);

    expect(res.status).toBe(200);
    expect(res.body.map((r: { id: string; can_withdraw: boolean }) => [r.id, r.can_withdraw])).toEqual([
      ["reg-open", true],
      ["reg-cancelled-event", false],
      ["reg-withdrawn", false],
    ]);
  });
});
// end of SCRUM-73
