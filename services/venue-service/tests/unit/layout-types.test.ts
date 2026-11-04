import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { ROLES, type LayoutTypeUsage, type LayoutTypeView } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import { layoutTypeInUse, notFound, validationFailed } from "../../src/domain/errors";
import type { LayoutTypeStore } from "../../src/readers/layoutTypeStore";
import type { SupabaseDeps } from "../../src/supabase";

// SCRUM-181 (docs/specs/layout-type-maintenance.md). An in-memory Supabase for the session and role lookup, as in
// venue-add.test.ts, and an in-memory store that behaves the way the database functions do, so no test touches a database.
type Row = Record<string, unknown>;

const THEATRE = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";
const BOARDROOM = "b685c8bf-c57d-5cb4-be30-49dedce9a02b";
const MISSING = "c685c8bf-c57d-5cb4-be30-49dedce9a02b";

function createFake() {
  const sessions = new Map<string, string>();
  const users: Row[] = [];

  const query = () => {
    const filters: [string, unknown][] = [];
    const run = () => users.filter((r) => filters.every(([col, val]) => r[col] === val)).map((r) => ({ ...r }));
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
    };
    return builder;
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
    forUser: () => ({ from: () => query() }),
  } as unknown as SupabaseDeps;

  const signIn = (role: string) => {
    const id = crypto.randomUUID();
    users.push({ id, role, full_name: "Test User", is_active: true });
    sessions.set(`token-${id}`, id);
    return { id, cookie: `cs_session=token-${id}` };
  };

  /** A session whose user has no profile row, so no role. */
  const signInWithoutProfile = () => {
    const id = crypto.randomUUID();
    sessions.set(`token-${id}`, id);
    return { cookie: `cs_session=token-${id}` };
  };

  return { deps, signIn, signInWithoutProfile };
}

/** A store that acts like create_layout_type, rename_layout_type and delete_layout_type, with a record of every call. */
function createStore(initial: { id: string; name: string; venues?: { id: string; name: string }[]; eventCount?: number }[] = []) {
  const types = initial.map((t) => ({ ...t, venues: t.venues ?? [], eventCount: t.eventCount ?? 0 }));
  const taken = (name: string, exceptId?: string) =>
    types.some((t) => t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase());
  let next = 1;

  const store = {
    list: vi.fn(async (): Promise<LayoutTypeView[]> =>
      [...types].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ id: t.id, name: t.name, isActive: true, venueCount: t.venues.length })),
    ),
    create: vi.fn(async (name: string) => {
      if (taken(name)) throw validationFailed({ name: "A layout type with that name already exists." });
      const id = `new-${next++}`;
      types.push({ id, name, venues: [], eventCount: 0 });
      return { id, name };
    }),
    rename: vi.fn(async (id: string, name: string) => {
      const type = types.find((t) => t.id === id);
      if (!type) throw notFound("Layout type not found.");
      if (taken(name, id)) throw validationFailed({ name: "A layout type with that name already exists." });
      type.name = name;
      return { id, name };
    }),
    remove: vi.fn(async (id: string) => {
      const index = types.findIndex((t) => t.id === id);
      if (index < 0) throw notFound("Layout type not found.");
      const type = types[index];
      const usage: LayoutTypeUsage = { venues: type.venues, eventCount: type.eventCount };
      if (usage.venues.length > 0 || usage.eventCount > 0) throw layoutTypeInUse(type.name, usage);
      types.splice(index, 1);
      return { id, name: type.name };
    }),
  } satisfies LayoutTypeStore;

  return { store, types, factory: () => store };
}

const OTHER_ROLES = ROLES.filter((r) => r !== "venue_staff");

describe("SCRUM-181/AC1 venue staff add a layout type (181-S1)", () => {
  it("181-S1: 201 with the new id and the cleaned name, and the type is then in the list", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const s = createStore([{ id: THEATRE, name: "Theatre" }]);
    const app = createApp(fake.deps, { layoutTypes: s.factory });

    const post = await request(app).post("/layout-types").set("Cookie", staff.cookie).send({ name: "  Hollow   Square " });

    expect(post.status).toBe(201);
    expect(post.body).toEqual({ id: "new-1", name: "Hollow Square" });
    expect(s.store.create).toHaveBeenCalledWith("Hollow Square");

    const list = await request(app).get("/layout-types").set("Cookie", staff.cookie);
    expect(list.status).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.body).toEqual([
      { id: "new-1", name: "Hollow Square", isActive: true, venueCount: 0 },
      { id: THEATRE, name: "Theatre", isActive: true, venueCount: 0 },
    ]);
  });

  it("181-S1: the list shows how many venues support each type", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const s = createStore([{ id: THEATRE, name: "Theatre", venues: [{ id: "v1", name: "Hall" }, { id: "v2", name: "Suite" }] }]);

    const list = await request(createApp(fake.deps, { layoutTypes: s.factory })).get("/layout-types").set("Cookie", staff.cookie);

    expect(list.body).toEqual([{ id: THEATRE, name: "Theatre", isActive: true, venueCount: 2 }]);
  });
});

describe("SCRUM-181/AC2 venue staff rename a layout type (181-S2)", () => {
  it("181-S2: 200 with the new name; the id stays the same", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const s = createStore([{ id: THEATRE, name: "Theatre", venues: [{ id: "v1", name: "Hall" }] }]);
    const app = createApp(fake.deps, { layoutTypes: s.factory });

    const patch = await request(app).patch(`/layout-types/${THEATRE}`).set("Cookie", staff.cookie).send({ name: " Lecture  Theatre " });

    expect(patch.status).toBe(200);
    expect(patch.body).toEqual({ id: THEATRE, name: "Lecture Theatre" });
    expect(s.store.rename).toHaveBeenCalledWith(THEATRE, "Lecture Theatre");
  });

  it("181-S2: changing only the case of its own name is allowed", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const s = createStore([{ id: THEATRE, name: "theatre" }]);

    const res = await request(createApp(fake.deps, { layoutTypes: s.factory }))
      .patch(`/layout-types/${THEATRE}`).set("Cookie", staff.cookie).send({ name: "Theatre" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Theatre");
  });

  it("181-S2: an unknown id is 404, and a malformed id is 404 too, once the role is known", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const s = createStore([{ id: THEATRE, name: "Theatre" }]);
    const app = createApp(fake.deps, { layoutTypes: s.factory });

    const unknown = await request(app).patch(`/layout-types/${MISSING}`).set("Cookie", staff.cookie).send({ name: "Cabaret" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe("NOT_FOUND");

    const malformed = await request(app).patch("/layout-types/not-an-id").set("Cookie", staff.cookie).send({ name: "Cabaret" });
    expect(malformed.status).toBe(404);
    expect(s.store.rename).toHaveBeenCalledTimes(1); // only the well-formed id reached the store
  });
});

describe("SCRUM-181/AC3 venue staff delete a layout type nothing uses (181-S3)", () => {
  it("181-S3: 200, the type is gone from the list", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const s = createStore([{ id: THEATRE, name: "Theatre" }, { id: BOARDROOM, name: "Boardroom" }]);
    const app = createApp(fake.deps, { layoutTypes: s.factory });

    const del = await request(app).delete(`/layout-types/${BOARDROOM}`).set("Cookie", staff.cookie);

    expect(del.status).toBe(200);
    expect(del.body).toEqual({ id: BOARDROOM, name: "Boardroom" });
    const list = await request(app).get("/layout-types").set("Cookie", staff.cookie);
    expect(list.body.map((t: LayoutTypeView) => t.name)).toEqual(["Theatre"]);
  });

  it("181-S3: an unknown or malformed id is 404", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const app = createApp(fake.deps, { layoutTypes: createStore().factory });

    expect((await request(app).delete(`/layout-types/${MISSING}`).set("Cookie", staff.cookie)).status).toBe(404);
    expect((await request(app).delete("/layout-types/nope").set("Cookie", staff.cookie)).status).toBe(404);
  });

  it("181-S3: the web app's preflight for DELETE is answered, so the browser may send it", async () => {
    const res = await request(createApp(createFake().deps)).options(`/layout-types/${THEATRE}`).set("Origin", "http://localhost:3000");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-methods"]).toContain("DELETE");
  });
});

describe("SCRUM-181/AC4 a layout type in use cannot be deleted (181-S4)", () => {
  it("181-S4: 409 LAYOUT_TYPE_IN_USE naming every venue that uses it, and the type is still there", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const venues = [{ id: "v1", name: "Marina Bayview Hall A" }, { id: "v2", name: "Orchard Suite 2" }];
    const s = createStore([{ id: THEATRE, name: "Theatre", venues }]);
    const app = createApp(fake.deps, { layoutTypes: s.factory });

    const del = await request(app).delete(`/layout-types/${THEATRE}`).set("Cookie", staff.cookie);

    expect(del.status).toBe(409);
    expect(del.body).toEqual({
      code: "LAYOUT_TYPE_IN_USE",
      error: '"Theatre" cannot be deleted because 2 venues use it: Marina Bayview Hall A, Orchard Suite 2.',
      usedBy: { venues, eventCount: 0 },
    });
    expect((await request(app).get("/layout-types").set("Cookie", staff.cookie)).body).toHaveLength(1);
  });

  it("181-S4: a type only an event request prefers is refused with the count and no event name", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const s = createStore([{ id: THEATRE, name: "Theatre", eventCount: 2 }]);

    const del = await request(createApp(fake.deps, { layoutTypes: s.factory })).delete(`/layout-types/${THEATRE}`).set("Cookie", staff.cookie);

    expect(del.status).toBe(409);
    expect(del.body.error).toBe('"Theatre" cannot be deleted because 2 event requests prefer it.');
    expect(del.body.usedBy).toEqual({ venues: [], eventCount: 2 });
  });

  it("181-S4: once the last venue drops the type, the delete goes through", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const s = createStore([{ id: THEATRE, name: "Theatre", venues: [{ id: "v1", name: "Hall" }] }]);
    const app = createApp(fake.deps, { layoutTypes: s.factory });

    expect((await request(app).delete(`/layout-types/${THEATRE}`).set("Cookie", staff.cookie)).status).toBe(409);
    s.types[0].venues = []; // the venue edit (SCRUM-58) took the layout off
    expect((await request(app).delete(`/layout-types/${THEATRE}`).set("Cookie", staff.cookie)).status).toBe(200);
  });
});

describe("SCRUM-181/AC5 empty and duplicate names (181-S5)", () => {
  it.each([
    ["an empty name", { name: "" }, "Enter a name for the layout type."],
    ["a blank name", { name: "   " }, "Enter a name for the layout type."],
    ["no name", {}, "Enter a name for the layout type."],
    ["a name over 60 characters", { name: "x".repeat(61) }, "The name can be at most 60 characters."],
  ])("181-S5: %s is a 422 on the name field, on add and on rename, and the store is not called", async (_label, body, message) => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const s = createStore([{ id: THEATRE, name: "Theatre" }]);
    const app = createApp(fake.deps, { layoutTypes: s.factory });

    const add = await request(app).post("/layout-types").set("Cookie", staff.cookie).send(body);
    const rename = await request(app).patch(`/layout-types/${THEATRE}`).set("Cookie", staff.cookie).send(body);

    for (const res of [add, rename]) {
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("VALIDATION_FAILED");
      expect(res.body.fieldErrors).toEqual({ name: message });
    }
    expect(s.store.create).not.toHaveBeenCalled();
    expect(s.store.rename).not.toHaveBeenCalled();
  });

  it("181-S5: a name another type has, ignoring case, is a 422 on the name field, on add and on rename", async () => {
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const s = createStore([{ id: THEATRE, name: "Theatre" }, { id: BOARDROOM, name: "Boardroom" }]);
    const app = createApp(fake.deps, { layoutTypes: s.factory });

    const add = await request(app).post("/layout-types").set("Cookie", staff.cookie).send({ name: "THEATRE" });
    const rename = await request(app).patch(`/layout-types/${BOARDROOM}`).set("Cookie", staff.cookie).send({ name: "theatre" });

    for (const res of [add, rename]) {
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ name: "A layout type with that name already exists." });
    }
    expect(s.types.map((t) => t.name)).toEqual(["Theatre", "Boardroom"]);
  });
});

describe("SCRUM-181/AC1 the real store is used when none is injected (181-S1)", () => {
  it("181-S1: GET /layout-types reads room_layouts as the caller through the default store", async () => {
    const rows = [{ id: THEATRE, name: "Theatre", is_active: true, venue_supported_layouts: [{ count: 2 }] }];
    const order = vi.fn(async () => ({ data: rows, error: null }));
    const callerTables: string[] = [];
    const fake = createFake();
    const staff = fake.signIn("venue_staff");
    const deps = {
      anon: fake.deps.anon,
      forUser: () => ({
        from: (table: string) => {
          callerTables.push(table);
          // the role lookup reads users; the list reads room_layouts
          return table === "users"
            ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "venue_staff" }, error: null }) }) }) }
            : { select: () => ({ order }) };
        },
      }),
    } as unknown as SupabaseDeps;

    const res = await request(createApp(deps)).get("/layout-types").set("Cookie", staff.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: THEATRE, name: "Theatre", isActive: true, venueCount: 2 }]);
    expect(callerTables).toEqual(["users", "room_layouts"]);
  });
});

describe("SCRUM-181/AC6 only venue staff (181-S6)", () => {
  const calls = [
    ["GET", (app: ReturnType<typeof createApp>, cookie: string) => request(app).get("/layout-types").set("Cookie", cookie)],
    ["POST", (app: ReturnType<typeof createApp>, cookie: string) => request(app).post("/layout-types").set("Cookie", cookie).send({})],
    ["PATCH", (app: ReturnType<typeof createApp>, cookie: string) => request(app).patch(`/layout-types/${THEATRE}`).set("Cookie", cookie).send({})],
    ["DELETE", (app: ReturnType<typeof createApp>, cookie: string) => request(app).delete(`/layout-types/${THEATRE}`).set("Cookie", cookie)],
  ] as const;

  it.each(OTHER_ROLES)("181-S6: %s gets 403 on all four routes, even with an invalid body, and nothing is written", async (role) => {
    const fake = createFake();
    const user = fake.signIn(role);
    const s = createStore([{ id: THEATRE, name: "Theatre" }]);
    const app = createApp(fake.deps, { layoutTypes: s.factory });

    for (const [, call] of calls) {
      const res = await call(app, user.cookie);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
    expect(s.store.list).not.toHaveBeenCalled();
    expect(s.store.create).not.toHaveBeenCalled();
    expect(s.store.rename).not.toHaveBeenCalled();
    expect(s.store.remove).not.toHaveBeenCalled();
  });

  it("181-S6: with no session every route is 401", async () => {
    const fake = createFake();
    const app = createApp(fake.deps, { layoutTypes: createStore().factory });

    for (const [, call] of calls) {
      expect((await call(app, "")).status).toBe(401);
    }
  });

  it("181-S6: a signed-in user with no profile row, so no role, is refused", async () => {
    const fake = createFake();
    const s = createStore([{ id: THEATRE, name: "Theatre" }]);
    const app = createApp(fake.deps, { layoutTypes: s.factory });

    const res = await request(app).get("/layout-types").set("Cookie", fake.signInWithoutProfile().cookie);

    expect(res.status).toBe(403);
    expect(s.store.list).not.toHaveBeenCalled();
  });
});
