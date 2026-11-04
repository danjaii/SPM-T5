import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-185/AC4 (docs/specs/registration-settings-while-replanning.md): GET and PUT /events/:id/registration-settings. The database
 * enforces the rules (update_registration_settings(), migration 84; tests/integration/registrationSettingsDb.test.ts); these cover
 * who may call the routes, the shared validation, and how the database's answers become responses.
 */
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string; hint?: string } | null };

const COORDINATOR = "cs_session=token-coordinator";
const OTHER = "cs_session=token-other";
const ORGANISER = "cs_session=token-organiser";
const USERS: Record<string, string> = { "token-coordinator": "c-1", "token-other": "c-2", "token-organiser": "o-1" };

const START = "2031-11-14T01:00:00+00:00";
const event = (over: Row = {}): Row => ({
  id: "evt-1",
  status: "planning",
  assigned_coordinator_id: "c-1",
  registration_required: true,
  registration_capacity: 100,
  registration_opens_at: "2031-01-01T00:00:00+00:00",
  registration_closes_at: "2031-11-10T00:00:00+00:00",
  preferred_start_datetime: START,
  ...over,
});
const GOOD = { registration_capacity: 40, registration_opens_at: "2031-10-01T01:00:00.000Z", registration_closes_at: "2031-11-13T01:00:00.000Z" };

function makeApp({ row = event() as Row | null, confirmed = 5, rpc = { data: [{}], error: null } as Result } = {}) {
  const rpcFn = vi.fn(async () => rpc);
  const deps = {
    anon: { auth: { getUser: async (token: string) => (USERS[token] ? { data: { user: { id: USERS[token] } }, error: null } : { data: { user: null }, error: { message: "bad" } }) } },
    forUser: () => ({
      from: (table: string) => {
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({ data: table === "events" ? row : null, error: null }),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, count: confirmed, error: null }).then(resolve),
        };
        return builder;
      },
      rpc: rpcFn,
    }),
  } as unknown as SupabaseDeps;
  return { app: createApp(deps), rpc: rpcFn };
}

describe("SCRUM-185/AC4 185-S4g GET /events/:id/registration-settings", () => {
  it("185-S4g: the assigned coordinator sees the current settings, the confirmed count, and that registration is closed while not Confirmed", async () => {
    const { app } = makeApp();

    const res = await request(app).get("/events/evt-1/registration-settings").set("Cookie", COORDINATOR);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "planning",
      registrationRequired: true,
      capacity: 100,
      opensAt: "2031-01-01T00:00:00+00:00",
      closesAt: "2031-11-10T00:00:00+00:00",
      eventStart: START,
      confirmedCount: 5,
      closedByStatus: true,
    });
  });

  it("185-S4g: a Confirmed event is not closed by its status", async () => {
    const { app } = makeApp({ row: event({ status: "confirmed" }) });
    expect((await request(app).get("/events/evt-1/registration-settings").set("Cookie", COORDINATOR)).body.closedByStatus).toBe(false);
  });

  it("185-S4e: another coordinator and an organiser are refused with 403", async () => {
    const { app } = makeApp();
    for (const cookie of [OTHER, ORGANISER]) {
      const res = await request(app).get("/events/evt-1/registration-settings").set("Cookie", cookie);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Only the coordinator assigned to this event can change its registration." });
    }
  });

  it("185-S4e: no session is 401, and an event the caller cannot read is 404", async () => {
    expect((await request(makeApp().app).get("/events/evt-1/registration-settings")).status).toBe(401);
    const res = await request(makeApp({ row: null }).app).get("/events/evt-9/registration-settings").set("Cookie", COORDINATOR);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Event not found." });
  });

  it("185-S4g: a count that cannot be read is a server error, never a silent zero", async () => {
    const deps = {
      anon: { auth: { getUser: async () => ({ data: { user: { id: "c-1" } }, error: null }) } },
      forUser: () => ({
        from: (table: string) => {
          const builder = {
            select: () => builder,
            eq: () => builder,
            maybeSingle: async () => ({ data: table === "events" ? event() : null, error: null }),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, count: null, error: { message: "boom" } }).then(resolve),
          };
          return builder;
        },
      }),
    } as unknown as SupabaseDeps;

    const res = await request(createApp(deps)).get("/events/evt-1/registration-settings").set("Cookie", COORDINATOR);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't load this event's registration settings. Please try again." });
  });
});

describe("SCRUM-185/AC4 185-S4b PUT /events/:id/registration-settings saves through the database", () => {
  it("185-S4b: the validated settings go to update_registration_settings and the answer shows them", async () => {
    const { app, rpc } = makeApp({ rpc: { data: [{ registration_capacity: 40 }], error: null } });

    const res = await request(app).put("/events/evt-1/registration-settings").set("Cookie", COORDINATOR).send({ ...GOOD, registration_capacity: "40" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ capacity: 40, opensAt: GOOD.registration_opens_at, closesAt: GOOD.registration_closes_at, message: "Registration settings saved." });
    expect(rpc).toHaveBeenCalledWith("update_registration_settings", {
      p_event_id: "evt-1",
      p_capacity: 40,
      p_opens: GOOD.registration_opens_at,
      p_closes: GOOD.registration_closes_at,
    });
  });
});

describe("SCRUM-185/AC4 185-S4d the shared validation runs first", () => {
  it.each([
    ["a closing time after the event starts", { registration_closes_at: "2031-11-15T00:00:00.000Z" }, "registration_closes_at"],
    ["a closing time before the opening time", { registration_closes_at: "2031-09-01T00:00:00.000Z" }, "registration_closes_at"],
    ["no capacity", { registration_capacity: undefined }, "registration_capacity"],
    ["a capacity of zero", { registration_capacity: 0 }, "registration_capacity"],
    ["a bad opening time", { registration_opens_at: "soon" }, "registration_opens_at"],
  ])("185-S4d: %s is 422 on %s and nothing is saved", async (_label, change, field) => {
    const { app, rpc } = makeApp();

    const res = await request(app).put("/events/evt-1/registration-settings").set("Cookie", COORDINATOR).send({ ...GOOD, ...change });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.fieldErrors)).toEqual([field]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("185-S4d: a body that is not an object is 422", async () => {
    const { app, rpc } = makeApp();
    const res = await request(app).put("/events/evt-1/registration-settings").set("Cookie", COORDINATOR).send([1, 2]);
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ body: "Send the settings as an object." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("SCRUM-185/AC4 185-S4e only the assigned coordinator may save", () => {
  it("185-S4e: another coordinator and an organiser get 403, even with an invalid body, and nothing is saved", async () => {
    const { app, rpc } = makeApp();
    for (const cookie of [OTHER, ORGANISER]) {
      for (const body of [GOOD, {}]) {
        expect((await request(app).put("/events/evt-1/registration-settings").set("Cookie", cookie).send(body)).status).toBe(403);
      }
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("185-S4e: no session is 401; an unknown event is 404", async () => {
    expect((await request(makeApp().app).put("/events/evt-1/registration-settings").send(GOOD)).status).toBe(401);
    expect((await request(makeApp({ row: null }).app).put("/events/evt-9/registration-settings").set("Cookie", COORDINATOR).send(GOOD)).status).toBe(404);
  });
});

describe("SCRUM-185/AC4 how the database's refusals become responses", () => {
  const save = (error: { code?: string; message: string; hint?: string }) =>
    request(makeApp({ rpc: { data: null, error } }).app).put("/events/evt-1/registration-settings").set("Cookie", COORDINATOR).send(GOOD);

  it("185-S4e: 42501 is 403", async () => {
    const res = await save({ code: "42501", message: "no" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Only the coordinator assigned to this event can change its registration." });
  });

  it("185-S4f: P0002 is 404", async () => {
    expect((await save({ code: "P0002", message: "x" })).status).toBe(404);
  });

  it("185-S4f: CL001 (a closed event) is 409 and locked", async () => {
    const res = await save({ code: "CL001", message: "closed" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "EVENT_LOCKED", error: "This event is closed, so its registration can't be changed." });
  });

  it("185-S4c: 22023 with a field hint is 422 on that field, with the database's message", async () => {
    const res = await save({ code: "22023", message: "5 attendees are already confirmed, so the capacity can't be lower than 5.", hint: "registration_capacity" });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      code: "VALIDATION_FAILED",
      error: "5 attendees are already confirmed, so the capacity can't be lower than 5.",
      fieldErrors: { registration_capacity: "5 attendees are already confirmed, so the capacity can't be lower than 5." },
    });
  });

  it("185-S4f: 22023 for an event that takes no registrations is 422 on the form", async () => {
    const res = await save({ code: "22023", message: "This event does not take registrations", hint: "registration" });
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ form: "This event does not take registrations" });
  });

  it("185-S4b: anything else is a server error with a plain message", async () => {
    const res = await save({ code: "XX000", message: "boom" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't save the registration settings. Please try again." });
  });
});
