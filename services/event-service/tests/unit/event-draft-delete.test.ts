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
  const tables: Record<string, Row[]> = { users: [], events: [] };
  const rpcCalls: { fn: string; args: Row; token: string }[] = [];
  const failure = { code: undefined as string | undefined, message: "database error" };

  const usersQuery = (callerId: string | undefined) => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      maybeSingle: async () => {
        const row = tables.users.find((r) => filters.every(([c, v]) => r[c] === v));
        return { data: row ? { ...row } : null, error: null };
      },
    };
    void callerId;
    return builder;
  };

  /** Pretends to be delete_event_draft (migration 55, security definer): the caller's own draft only. */
  const deleteEventDraft = (callerId: string | undefined, args: Row) => {
    if (failure.code !== undefined || failure.message !== "database error") {
      return { error: { message: failure.message, code: failure.code } };
    }
    const index = tables.events.findIndex((e) => e.id === args.p_event_id && e.organiser_id === callerId);
    if (index < 0) return { error: { message: "not found", code: "DR001" } };
    const event = tables.events[index];
    if (event.status !== "draft" || event.is_draft !== true) return { error: { message: "not a draft", code: "DR002" } };
    tables.events.splice(index, 1);
    return { error: null };
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
      from: (table: string) => {
        if (table !== "users") throw new Error(`fake has no table ${table}`);
        return usersQuery(sessions.get(token));
      },
      rpc: (fn: string, args: Row) => {
        rpcCalls.push({ fn, args, token });
        if (fn !== "delete_event_draft") throw new Error(`fake has no function ${fn}`);
        const result = deleteEventDraft(sessions.get(token), args);
        // supabase-js's rpc() is awaitable
        return { then: (resolve: (r: unknown) => unknown) => resolve(result) };
      },
    }),
  } as unknown as SupabaseDeps;

  const signIn = (role: string) => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: "Test User", is_active: true });
    sessions.set(`token-${id}`, id);
    return { id, token: `token-${id}`, cookie: `cs_session=token-${id}` };
  };

  const addEvent = (organiserId: string, extra: Row = {}) => {
    const event: Row = { id: crypto.randomUUID(), name: "Tech Summit", organiser_id: organiserId, status: "draft", is_draft: true, ...extra };
    tables.events.push(event);
    return event;
  };

  return { deps, tables, rpcCalls, failure, signIn, addEvent };
}
// end of fake Supabase

const MISSING_ID = "00000000-0000-4000-8000-000000000000";
const del = (fake: ReturnType<typeof createFake>, id: string, cookie?: string) => {
  const req = request(createApp(fake.deps)).delete(`/events/drafts/${id}`);
  return cookie ? req.set("Cookie", cookie) : req;
};

describe("SCRUM-56/AC1 delete a draft (DELETE /events/drafts/:id)", () => {
  it("SCRUM-56/AC1 removes the organiser's own draft and answers 204 with no body", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);
    const other = fake.addEvent(organiser.id, { name: "Career Fair" });

    const res = await del(fake, String(draft.id), organiser.cookie);

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(fake.tables.events.map((e) => e.id)).toEqual([other.id]);
  });

  it("SCRUM-56/AC1 deletes through delete_event_draft as the caller, with only the event id", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    await del(fake, String(draft.id), organiser.cookie);

    expect(fake.rpcCalls).toEqual([{ fn: "delete_event_draft", args: { p_event_id: draft.id }, token: organiser.token }]);
  });

  it("SCRUM-56/AC1 answers 404 for a draft that is not the caller's or does not exist, and leaves the other organiser's draft", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const owner = fake.signIn("event_organiser");
    const theirs = fake.addEvent(owner.id);

    const notTheirs = await del(fake, String(theirs.id), organiser.cookie);
    const missing = await del(fake, MISSING_ID, organiser.cookie);

    expect(notTheirs.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(notTheirs.body).toEqual(missing.body); // the caller cannot tell "not yours" from "not there"
    expect(fake.tables.events).toHaveLength(1);
  });

  it("SCRUM-56/AC1 answers 404 for an id that is not a uuid without asking the database", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await del(fake, "not-a-uuid", organiser.cookie);

    expect(res.status).toBe(404);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("SCRUM-56/AC1 answers 401 without a session", async () => {
    const fake = createFake();
    const res = await del(fake, MISSING_ID);
    expect(res.status).toBe(401);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("SCRUM-56/AC1 answers 403 to a role that cannot create event requests, and deletes nothing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);

    for (const role of ["event_coordinator", "attendee", "venue_staff", "event_coordinator_lead"]) {
      const user = fake.signIn(role);
      const res = await del(fake, String(draft.id), user.cookie);
      expect(res.status).toBe(403);
    }
    expect(fake.tables.events).toHaveLength(1);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("SCRUM-56/AC1 answers 403 to a signed-in user with no profile row", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    fake.tables.users.length = 0;

    const res = await del(fake, MISSING_ID, organiser.cookie);

    expect(res.status).toBe(403);
  });

  it("SCRUM-56/AC1 answers 500 with a plain message for any other database failure", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const draft = fake.addEvent(organiser.id);
    fake.failure.code = "23503"; // e.g. a copy of the draft still points at it (cloned_from_event_id)

    const res = await del(fake, String(draft.id), organiser.cookie);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Could not delete the draft." });
    expect(fake.tables.events).toHaveLength(1);
  });
});

describe("SCRUM-56/AC2 a submitted request cannot be deleted", () => {
  it("SCRUM-56/AC2 answers 409 NOT_A_DRAFT for the organiser's own submitted request and keeps it", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const submitted = fake.addEvent(organiser.id, { status: "submitted", is_draft: false });

    const res = await del(fake, String(submitted.id), organiser.cookie);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "NOT_A_DRAFT", error: "This request has been submitted, so it can no longer be deleted." });
    expect(fake.tables.events).toHaveLength(1);
  });

  it.each(["under_review", "approved", "planning", "confirmed", "completed", "cancelled", "rejected"])(
    "SCRUM-56/AC2 answers 409 for a request in status %s",
    async (status) => {
      const fake = createFake();
      const organiser = fake.signIn("event_organiser");
      const event = fake.addEvent(organiser.id, { status, is_draft: false });

      const res = await del(fake, String(event.id), organiser.cookie);

      expect(res.status).toBe(409);
      expect(fake.tables.events).toHaveLength(1);
    },
  );
});
