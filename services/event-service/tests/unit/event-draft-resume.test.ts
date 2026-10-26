import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fake Supabase (in memory) so tests never touch the real database
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

const FIELD_ARGS = [
  "name", "purpose", "description", "preferred_start_datetime", "preferred_end_datetime", "expected_attendance",
  "venue_requirements", "preferred_room_layout_id", "accessibility_requirements", "equipment_requirements_notes",
  "registration_required", "registration_capacity", "registration_opens_at", "registration_closes_at",
] as const;

function createFake() {
  const sessions = new Map<string, string>(); // login token -> user id
  const tables: Record<string, Row[]> = { users: [], events: [], event_status_history: [] };
  const rpcCalls: { fn: string; args: Row }[] = [];
  const failure = { update: false, submit: false, submitCode: undefined as string | undefined, updateReturnsNothing: false };
  const clock = { now: () => new Date() };

  // reads behave like RLS: a user only sees their own events (migration 14 gives the organiser their own rows)
  const query = (table: string, callerId: string | undefined) => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
      maybeSingle: async () => {
        const rows = tables[table].filter(
          (r) => (table !== "events" || r.organiser_id === callerId) && filters.every(([col, val]) => r[col] === val),
        );
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      },
    };
    return builder;
  };

  /** Pretends to be update_event_draft (migration 53): the caller's own draft only, the 14 draft fields only. */
  const updateEventDraft = (callerId: string | undefined, args: Row) => {
    const event = tables.events.find((e) => e.id === args.p_event_id && e.organiser_id === callerId && e.status === "draft");
    if (!event || failure.updateReturnsNothing) return { data: null, error: null };
    for (const field of FIELD_ARGS) event[field] = args[`p_${field}`] ?? (field === "registration_required" ? false : null);
    if (typeof event.name !== "string" || event.name.trim() === "") event.name = "Untitled draft";
    event.updated_at = clock.now().toISOString();
    return { data: { ...event }, error: null };
  };

  /** Pretends to be submit_event_draft (migration 53): the caller's own draft, becomes submitted with a history row. */
  const submitEventDraft = (callerId: string | undefined, args: Row) => {
    if (failure.submitCode) return { data: null, error: { message: "refused", code: failure.submitCode } };
    const event = tables.events.find((e) => e.id === args.p_event_id && e.organiser_id === callerId);
    if (!event) return { data: null, error: { message: "not found", code: "DR001" } };
    if (event.status !== "draft") return { data: null, error: { message: "not a draft", code: "DR002" } };
    const stamp = clock.now().toISOString();
    Object.assign(event, { status: "submitted", is_draft: false, submitted_at: stamp, updated_at: stamp });
    if (event.registration_required !== true) {
      Object.assign(event, { registration_capacity: null, registration_opens_at: null, registration_closes_at: null });
    }
    tables.event_status_history.push({ event_id: event.id, old_status: "draft", new_status: "submitted", changed_by: callerId });
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
      from: (table: string) => query(table, sessions.get(token)),
      rpc: (fn: string, args: Row) => {
        const run = async () => {
          rpcCalls.push({ fn, args });
          if (fn === "update_event_draft") {
            if (failure.update) return { data: null, error: { message: "database error" } };
            return updateEventDraft(sessions.get(token), args);
          }
          if (fn === "submit_event_draft") return submitEventDraft(sessions.get(token), args);
          throw new Error(`fake has no function ${fn}`);
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

  const addEvent = (organiserId: string, extra: Row = {}) => {
    const stamp = "2031-01-01T00:00:00.000Z";
    const event: Row = {
      id: crypto.randomUUID(), name: "Untitled draft", purpose: null, description: null, preferred_start_datetime: null,
      preferred_end_datetime: null, expected_attendance: null, venue_requirements: null, preferred_room_layout_id: null,
      accessibility_requirements: null, equipment_requirements_notes: null, registration_required: false,
      registration_capacity: null, registration_opens_at: null, registration_closes_at: null,
      organiser_id: organiserId, assigned_coordinator_id: null, status: "draft", is_draft: true, submitted_at: null,
      created_at: stamp, updated_at: stamp, ...extra,
    };
    tables.events.push(event);
    return event;
  };

  return { deps, tables, rpcCalls, failure, clock, signIn, addEvent };
}
// end of fake Supabase

const LAYOUT_ID = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";
const MISSING_ID = "00000000-0000-4000-8000-000000000000";

describe("SCRUM-54/AC1 open a draft (GET /events/drafts/:id)", () => {
  it("returns the stored fields of the caller's draft, ids included, with its last-saved time", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, {
      name: "Tech Summit", purpose: "Showcase", expected_attendance: 250, preferred_room_layout_id: LAYOUT_ID,
      registration_required: true, registration_capacity: 200, updated_at: "2031-02-03T04:05:06.000Z",
    });

    const res = await request(createApp(fake.deps)).get(`/events/drafts/${draft.id}`).set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: draft.id, name: "Tech Summit", purpose: "Showcase", expected_attendance: 250, preferred_room_layout_id: LAYOUT_ID,
      registration_required: true, registration_capacity: 200, status: "draft", is_draft: true, submitted_at: null,
      updated_at: "2031-02-03T04:05:06.000Z",
    });
  });

  it("returns empty fields as null and an unnamed draft as Untitled draft", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    const res = await request(createApp(fake.deps)).get(`/events/drafts/${draft.id}`).set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Untitled draft", purpose: null, description: null, preferred_start_datetime: null, expected_attendance: null });
  });

  it("answers 404 for a draft that does not exist or is not the caller's, and for an id that is not a uuid", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const other = fake.signIn("event_organiser");
    const theirs = fake.addEvent(other.id);
    const app = createApp(fake.deps);

    for (const id of [theirs.id, MISSING_ID, "not-a-uuid"]) {
      const res = await request(app).get(`/events/drafts/${id}`).set("Cookie", organiser.cookie);
      expect(res.status).toBe(404);
    }
  });

  it("answers 401 without a session", async () => {
    const fake = createFake();
    const res = await request(createApp(fake.deps)).get(`/events/drafts/${MISSING_ID}`);
    expect(res.status).toBe(401);
  });

  it("answers 403 to a role that cannot create event requests", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);
    const app = createApp(fake.deps);

    for (const role of ["event_coordinator", "attendee", "venue_staff", "event_coordinator_lead"]) {
      const user = fake.signIn(role);
      const res = await request(app).get(`/events/drafts/${draft.id}`).set("Cookie", user.cookie);
      expect(res.status).toBe(403);
    }
  });
});
