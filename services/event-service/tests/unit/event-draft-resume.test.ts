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

describe("SCRUM-54/AC2 re-save a draft (PUT /events/drafts/:id)", () => {
  const put = (fake: ReturnType<typeof createFake>, cookie: string, id: string, body: unknown) =>
    request(createApp(fake.deps)).put(`/events/drafts/${id}`).set("Cookie", cookie).send(body as object);

  it("updates the draft with the new information and answers 200 with the row", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, { name: "Old name", expected_attendance: 10 });

    const res = await put(fake, organiser.cookie, draft.id as string, { name: "New name", expected_attendance: 120, purpose: "Demo day" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: draft.id, name: "New name", expected_attendance: 120, purpose: "Demo day", status: "draft" });
    expect(fake.tables.events[0]).toMatchObject({ name: "New name", expected_attendance: 120, purpose: "Demo day" });
    expect(fake.tables.events).toHaveLength(1);
  });

  it("passes the event id and every draft field to update_event_draft, and nothing else", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    await put(fake, organiser.cookie, draft.id as string, {
      name: "N", organiser_id: "someone-else", status: "approved", assigned_coordinator_id: "x", submitted_at: "2031-01-01T00:00:00Z",
    });

    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0].fn).toBe("update_event_draft");
    expect(Object.keys(fake.rpcCalls[0].args).sort()).toEqual(
      [
        "p_event_id", "p_name", "p_purpose", "p_description", "p_preferred_start_datetime", "p_preferred_end_datetime",
        "p_expected_attendance", "p_venue_requirements", "p_preferred_room_layout_id", "p_accessibility_requirements",
        "p_equipment_requirements_notes", "p_registration_required", "p_registration_capacity", "p_registration_opens_at",
        "p_registration_closes_at",
      ].sort(),
    );
    expect(fake.rpcCalls[0].args.p_event_id).toBe(draft.id);
  });

  it("refreshes the last-saved time", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, { updated_at: "2031-01-01T00:00:00.000Z" });
    fake.clock.now = () => new Date("2031-06-01T10:00:00.000Z");

    const res = await put(fake, organiser.cookie, draft.id as string, { name: "Again" });

    expect(res.body.updated_at).toBe("2031-06-01T10:00:00.000Z");
  });

  it("clears a field the organiser left out or emptied", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, { name: "Keep", purpose: "Remove me", expected_attendance: 30, description: "Also gone" });

    const res = await put(fake, organiser.cookie, draft.id as string, { name: "Keep", purpose: "   ", expected_attendance: null });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Keep", purpose: null, expected_attendance: null, description: null });
  });

  it("saves an empty body as an untitled, empty draft", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, { name: "Had a name", purpose: "x" });

    const res = await put(fake, organiser.cookie, draft.id as string, {});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Untitled draft", purpose: null });
  });

  it("answers 422 with the field errors and changes nothing for an invalid value", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, { name: "Before", expected_attendance: 5 });

    const res = await put(fake, organiser.cookie, draft.id as string, { name: "After", expected_attendance: -4 });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", error: "Check the highlighted fields." });
    expect(res.body.fieldErrors).toHaveProperty("expected_attendance");
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fake.tables.events[0]).toMatchObject({ name: "Before", expected_attendance: 5 });
  });

  it("answers 404 for a draft that is not the caller's, or does not exist, without writing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const other = fake.signIn("event_organiser");
    const theirs = fake.addEvent(other.id, { name: "Theirs" });

    for (const id of [theirs.id as string, MISSING_ID, "not-a-uuid"]) {
      expect((await put(fake, organiser.cookie, id, { name: "Mine now" })).status).toBe(404);
    }
    expect(fake.rpcCalls).toHaveLength(0);
    expect(theirs.name).toBe("Theirs");
  });

  it("answers 500 when the database refuses the write", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);
    fake.failure.update = true;

    const res = await put(fake, organiser.cookie, draft.id as string, { name: "x" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Could not save the draft." });
  });

  it("answers 401 without a session and 403 to other roles", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, { name: "Untouched" });
    const app = createApp(fake.deps);

    expect((await request(app).put(`/events/drafts/${draft.id}`).send({ name: "x" })).status).toBe(401);
    for (const role of ["event_coordinator", "attendee", "venue_staff", "technical_support_staff", "safety_officer", "event_coordinator_lead"]) {
      const user = fake.signIn(role);
      expect((await put(fake, user.cookie, draft.id as string, { name: "x" })).status).toBe(403);
    }
    expect(fake.rpcCalls).toHaveLength(0);
    expect(draft.name).toBe("Untouched");
  });
});

const COMPLETE = {
  name: "Tech Summit",
  purpose: "Showcase",
  description: "A day of demos",
  preferred_start_datetime: "2031-05-01T09:00:00.000Z",
  preferred_end_datetime: "2031-05-01T17:00:00.000Z",
  expected_attendance: 250,
  venue_requirements: "A stage",
  preferred_room_layout_id: LAYOUT_ID,
  accessibility_requirements: "None required",
  equipment_requirements_notes: "Two microphones",
  registration_required: false,
};

describe("SCRUM-54/AC3 submit a draft (POST /events/drafts/:id/submit)", () => {
  const submit = (fake: ReturnType<typeof createFake>, cookie: string, id: string, body?: unknown, now?: () => Date) => {
    const req = request(createApp(fake.deps, { now })).post(`/events/drafts/${id}/submit`).set("Cookie", cookie);
    return body === undefined ? req : req.send(body as object);
  };

  it("submits a complete saved draft: status Submitted, not a draft, submitted_at set, answers 200", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, COMPLETE);

    const res = await submit(fake, organiser.cookie, draft.id as string);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: draft.id, status: "submitted", is_draft: false, assigned_coordinator_id: null });
    expect(typeof res.body.submitted_at).toBe("string");
    expect(fake.tables.events[0]).toMatchObject({ status: "submitted", is_draft: false });
  });

  it("records one draft -> submitted history row in the organiser's name and leaves no coordinator", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, COMPLETE);

    await submit(fake, organiser.cookie, draft.id as string);

    expect(fake.tables.event_status_history).toEqual([
      { event_id: draft.id, old_status: "draft", new_status: "submitted", changed_by: organiser.id },
    ]);
    expect(fake.tables.events[0].assigned_coordinator_id).toBeNull();
  });

  it("with no body, asks the database only to submit the saved draft", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, COMPLETE);

    await submit(fake, organiser.cookie, draft.id as string);

    expect(fake.rpcCalls).toEqual([{ fn: "submit_event_draft", args: { p_event_id: draft.id } }]);
  });

  it("with a body, saves those fields first and then submits (save and submit)", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, { name: "Old" });

    const res = await submit(fake, organiser.cookie, draft.id as string, { ...COMPLETE, name: "Saved and submitted" });

    expect(res.status).toBe(200);
    expect(fake.rpcCalls.map((c) => c.fn)).toEqual(["update_event_draft", "submit_event_draft"]);
    expect(res.body).toMatchObject({ name: "Saved and submitted", expected_attendance: 250, status: "submitted" });
  });

  it("clears registration capacity and window when registration is not needed, as POST /events does", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, COMPLETE);

    const res = await submit(fake, organiser.cookie, draft.id as string, {
      ...COMPLETE,
      registration_required: false,
      registration_capacity: 50,
      registration_opens_at: "2031-04-01T09:00:00.000Z",
      registration_closes_at: "2031-04-20T09:00:00.000Z",
    });

    expect(res.body).toMatchObject({ registration_capacity: null, registration_opens_at: null, registration_closes_at: null });
  });

  it("submits a draft that asks for registration when the capacity and window are filled in", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, {
      ...COMPLETE,
      registration_required: true,
      registration_capacity: 200,
      registration_opens_at: "2031-04-01T09:00:00.000Z",
      registration_closes_at: "2031-04-20T09:00:00.000Z",
    });

    const res = await submit(fake, organiser.cookie, draft.id as string);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ registration_required: true, registration_capacity: 200 });
  });

  it("answers 422 listing every missing field and leaves an incomplete draft as it was", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, { name: "Half done", purpose: "Only this" });

    const res = await submit(fake, organiser.cookie, draft.id as string);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "VALIDATION_FAILED", error: "Check the highlighted fields." });
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(
      [
        "accessibility_requirements", "description", "equipment_requirements_notes", "expected_attendance",
        "preferred_end_datetime", "preferred_room_layout_id", "preferred_start_datetime", "venue_requirements",
      ].sort(),
    );
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fake.tables.events[0]).toMatchObject({ status: "draft", is_draft: true, submitted_at: null });
    expect(fake.tables.event_status_history).toHaveLength(0);
  });

  it("does not accept the placeholder name of an unnamed draft", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, { ...COMPLETE, name: "Untitled draft" });

    const res = await submit(fake, organiser.cookie, draft.id as string);

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ name: "Enter the event name." });
  });

  it("applies the same rules as a new request: a start date in the past is refused", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, COMPLETE);

    const res = await submit(fake, organiser.cookie, draft.id as string, undefined, () => new Date("2035-01-01T00:00:00Z"));

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toHaveProperty("preferred_start_datetime");
  });

  it("answers 422 and saves nothing when the body sent with the submit is invalid", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, { ...COMPLETE, name: "Stays" });

    const res = await submit(fake, organiser.cookie, draft.id as string, { ...COMPLETE, expected_attendance: 0 });

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toHaveProperty("expected_attendance");
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fake.tables.events[0]).toMatchObject({ name: "Stays", status: "draft", expected_attendance: 250 });
  });

  it("answers 404 for a draft that is not the caller's, and for an id that is not a uuid", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const other = fake.signIn("event_organiser");
    const theirs = fake.addEvent(other.id, COMPLETE);

    for (const id of [theirs.id as string, MISSING_ID, "not-a-uuid"]) {
      expect((await submit(fake, organiser.cookie, id)).status).toBe(404);
    }
    expect(fake.rpcCalls).toHaveLength(0);
    expect(theirs.status).toBe("draft");
  });

  it("answers 404 when the database says it is no longer the caller's draft", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, COMPLETE);
    fake.failure.submitCode = "DR001";

    expect((await submit(fake, organiser.cookie, draft.id as string)).status).toBe(404);
  });

  it("answers 500 when the database refuses the submission for another reason", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, COMPLETE);
    fake.failure.submitCode = "XX000";

    const res = await submit(fake, organiser.cookie, draft.id as string);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Could not submit the request." });
  });

  it("answers 500 when saving the body before the submit fails, and does not submit", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, COMPLETE);
    fake.failure.update = true;

    const res = await submit(fake, organiser.cookie, draft.id as string, COMPLETE);

    expect(res.status).toBe(500);
    expect(fake.rpcCalls.map((c) => c.fn)).toEqual(["update_event_draft"]);
  });

  it("answers 401 without a session and 403 to other roles", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id, COMPLETE);
    const app = createApp(fake.deps);

    expect((await request(app).post(`/events/drafts/${draft.id}/submit`)).status).toBe(401);
    for (const role of ["event_coordinator", "attendee", "venue_staff", "event_coordinator_lead"]) {
      const user = fake.signIn(role);
      expect((await submit(fake, user.cookie, draft.id as string)).status).toBe(403);
    }
    expect(draft.status).toBe("draft");
  });
});
