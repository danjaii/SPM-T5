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
  const rpcCalls: { fn: string; args: Row }[] = [];
  const failure = { createEventDraft: false };
  const clock = { now: () => new Date() };

  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
      maybeSingle: async () => {
        const rows = tables[table].filter((r) => filters.every(([col, val]) => r[col] === val));
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      },
    };
    return builder;
  };

  /**
   * Pretends to be create_event_draft (migration 52). Like the real one: the organiser is auth.uid(), the
   * organisation comes from the caller's users row, the name falls back to "Untitled draft", status is draft.
   */
  const createEventDraft = (callerId: string | undefined, args: Row) => {
    const caller = tables.users.find((u) => u.id === callerId);
    const name = typeof args.p_name === "string" && args.p_name.trim() !== "" ? args.p_name.trim() : "Untitled draft";
    const stamp = clock.now().toISOString();
    const event: Row = {
      id: crypto.randomUUID(),
      name,
      purpose: args.p_purpose ?? null,
      description: args.p_description ?? null,
      preferred_start_datetime: args.p_preferred_start_datetime ?? null,
      preferred_end_datetime: args.p_preferred_end_datetime ?? null,
      expected_attendance: args.p_expected_attendance ?? null,
      venue_requirements: args.p_venue_requirements ?? null,
      preferred_room_layout_id: args.p_preferred_room_layout_id ?? null,
      accessibility_requirements: args.p_accessibility_requirements ?? null,
      equipment_requirements_notes: args.p_equipment_requirements_notes ?? null,
      registration_required: args.p_registration_required ?? false,
      registration_capacity: args.p_registration_capacity ?? null,
      registration_opens_at: args.p_registration_opens_at ?? null,
      registration_closes_at: args.p_registration_closes_at ?? null,
      organiser_id: callerId,
      client_organisation_id: caller?.organisation_id ?? null,
      assigned_coordinator_id: null,
      status: "draft",
      is_draft: true,
      submitted_at: null,
      created_at: stamp,
      updated_at: stamp,
    };
    tables.events.push(event);
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
          if (fn !== "create_event_draft") throw new Error(`fake has no function ${fn}`);
          if (failure.createEventDraft) return { data: null, error: { message: "database error" } };
          return createEventDraft(sessions.get(token), args);
        };
        return { single: run, maybeSingle: run };
      },
    }),
  } as unknown as SupabaseDeps;

  const signIn = (role: string, extra: Row = {}) => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: "Test User", is_active: true, organisation_id: null, ...extra });
    sessions.set(`token-${id}`, id);
    return { id, cookie: `cs_session=token-${id}` };
  };

  return { deps, tables, rpcCalls, failure, clock, signIn };
}
// end of fake Supabase

const THEATRE_LAYOUT_ID = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";

describe("SCRUM-53/AC1 save a draft (POST /events/drafts)", () => {
  it("stores an incomplete request with status draft and answers 201", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await request(createApp(fake.deps))
      .post("/events/drafts")
      .set("Cookie", organiser.cookie)
      .send({ name: "Half-planned summit", expected_attendance: 120 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Half-planned summit", status: "draft", is_draft: true, expected_attendance: 120 });
    expect(typeof res.body.id).toBe("string");
    expect(fake.tables.events).toHaveLength(1);
    expect(fake.tables.events[0]).toMatchObject({ status: "draft", is_draft: true, submitted_at: null });
  });

  it("keeps every field that was sent", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const body = {
      name: "Tech Summit",
      purpose: "Showcase",
      description: "A day of demos",
      preferred_start_datetime: "2031-05-01T09:00:00.000Z",
      preferred_end_datetime: "2031-05-01T17:00:00.000Z",
      expected_attendance: 250,
      venue_requirements: "A stage",
      preferred_room_layout_id: THEATRE_LAYOUT_ID,
      accessibility_requirements: "Ramp",
      equipment_requirements_notes: "Two microphones",
      registration_required: true,
      registration_capacity: 200,
      registration_opens_at: "2031-04-01T09:00:00.000Z",
      registration_closes_at: "2031-04-20T09:00:00.000Z",
    };

    const res = await request(createApp(fake.deps)).post("/events/drafts").set("Cookie", organiser.cookie).send(body);

    expect(res.status).toBe(201);
    expect(fake.tables.events[0]).toMatchObject(body);
  });

  it("leaves the fields that were not sent empty", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    await request(createApp(fake.deps)).post("/events/drafts").set("Cookie", organiser.cookie).send({ name: "Only a name" });

    expect(fake.tables.events[0]).toMatchObject({ purpose: null, preferred_start_datetime: null, expected_attendance: null });
  });

  it("takes the organiser and organisation from the caller, not from the body", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", { organisation_id: "org-1" });
    const someoneElse = fake.signIn("event_organiser");

    const res = await request(createApp(fake.deps))
      .post("/events/drafts")
      .set("Cookie", organiser.cookie)
      .send({
        name: "Spoof attempt",
        organiser_id: someoneElse.id,
        client_organisation_id: "org-2",
        status: "approved",
        is_draft: false,
        assigned_coordinator_id: someoneElse.id,
        submitted_at: "2031-01-01T00:00:00.000Z",
      });

    expect(res.status).toBe(201);
    expect(fake.tables.events[0]).toMatchObject({
      organiser_id: organiser.id,
      client_organisation_id: "org-1",
      status: "draft",
      is_draft: true,
      assigned_coordinator_id: null,
      submitted_at: null,
    });
    const sent = fake.rpcCalls[0].args;
    expect(Object.keys(sent).filter((k) => /organiser|organisation|status|coordinator|submitted/.test(k))).toEqual([]);
  });

  it("writes no status history row (history starts at submission)", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await request(createApp(fake.deps)).post("/events/drafts").set("Cookie", organiser.cookie).send({ name: "No history" });

    expect(res.status).toBe(201);
    expect(fake.tables.event_status_history).toHaveLength(0);
  });

  it("answers 500 and stores nothing when the database fails", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    fake.failure.createEventDraft = true;

    const res = await request(createApp(fake.deps)).post("/events/drafts").set("Cookie", organiser.cookie).send({ name: "Fails" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Could not save the draft." });
    expect(fake.tables.events).toHaveLength(0);
  });
});

describe("SCRUM-53/AC2 a draft is not blocked by empty fields", () => {
  it("saves an empty body as 'Untitled draft'", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await request(createApp(fake.deps)).post("/events/drafts").set("Cookie", organiser.cookie).send({});

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Untitled draft", status: "draft", purpose: null });
  });

  it("saves a request whose every field is blank", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await request(createApp(fake.deps))
      .post("/events/drafts")
      .set("Cookie", organiser.cookie)
      .send({ name: "  ", purpose: "", description: "", expected_attendance: "", preferred_start_datetime: "", registration_required: false });

    expect(res.status).toBe(201);
    expect(fake.tables.events[0]).toMatchObject({ name: "Untitled draft", purpose: null, expected_attendance: null, preferred_start_datetime: null });
  });

  it("sends blank values to the database as null, not as empty strings", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    await request(createApp(fake.deps)).post("/events/drafts").set("Cookie", organiser.cookie).send({ name: "", purpose: "", expected_attendance: "" });

    expect(fake.rpcCalls[0].args).toMatchObject({ p_name: null, p_purpose: null, p_expected_attendance: null });
  });

  it("still answers 422 with the field errors, and stores nothing, for a value the database would refuse", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await request(createApp(fake.deps))
      .post("/events/drafts")
      .set("Cookie", organiser.cookie)
      .send({ name: "Bad numbers", expected_attendance: -5, preferred_start_datetime: "2031-05-02T09:00:00Z", preferred_end_datetime: "2031-05-01T09:00:00Z" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", error: "Check the highlighted fields." });
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["expected_attendance", "preferred_end_datetime"]);
    expect(fake.tables.events).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });
});
