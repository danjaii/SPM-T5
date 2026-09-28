import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fake Supabase — matches the shape used in event-review.test.ts
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function createFake() {
  const sessions = new Map<string, string>();
  const tables: Record<string, Row[]> = { users: [], events: [] };

  const makeQuery = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const orClauses: string[] = [];
    let pendingUpdate: Row | null = null;

    const applyFilters = () => {
      let rows = (tables[table] ?? []).filter((r) =>
        filters.every(([col, val]) => r[col] === val),
      );
      if (orClauses.length > 0) {
        rows = rows.filter((r) =>
          orClauses.some((clause) =>
            clause.split(",").some((part) => {
              const [col, op, ...rest] = part.trim().split(".");
              const val = rest.join(".");
              if (op === "eq") return r[col] === val;
              if (op === "is" && val === "null") return r[col] == null;
              return false;
            }),
          ),
        );
      }
      return rows;
    };

    const builder = {
      select: (_cols: string) => builder,
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return builder;
      },
      or: (filter: string) => {
        orClauses.push(filter);
        return builder;
      },
      update: (patch: Row) => {
        pendingUpdate = patch;
        return builder;
      },
      maybeSingle: (): Promise<{ data: Row | null; error: null }> => {
        const rows = applyFilters();
        if (!rows[0]) return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: { ...rows[0] }, error: null });
      },
      then<T>(
        onFulfilled?: ((v: { data: Row[]; error: null }) => T | PromiseLike<T>) | null,
        onRejected?: ((e: unknown) => T | PromiseLike<T>) | null,
      ): Promise<T> {
        if (pendingUpdate !== null) {
          const patch = pendingUpdate;
          const rows = applyFilters();
          for (const row of rows) Object.assign(row, patch);
          return Promise.resolve({ data: rows, error: null as null }).then(onFulfilled, onRejected);
        }
        const rows = applyFilters().map((r) => ({ ...r }));
        return Promise.resolve({ data: rows, error: null as null }).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };

  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) => {
          const id = sessions.get(token);
          return id
            ? { data: { user: { id } }, error: null }
            : { data: { user: null }, error: { message: "bad token" } };
        },
      },
    },
    forUser: (_token: string) => ({
      from: (table: string) => makeQuery(table),
      rpc: (_fn: string, _args: Row) => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }),
  } as unknown as SupabaseDeps;

  const signIn = (role: string, fullName = "Test User", isActive = true) => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: fullName, is_active: isActive });
    sessions.set(`token-${id}`, id);
    return { id, cookie: `cs_session=token-${id}` };
  };

  return { deps, tables, signIn };
}

// ---------------------------------------------------------------------------
// SCRUM-42/AC1 — View eligible coordinators
// ---------------------------------------------------------------------------
describe("SCRUM-42/AC1 — View eligible coordinators", () => {
  it("returns eligible coordinators (active, event_coordinator role) for an unassigned event", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice Johnson");
    const coordinator = fake.signIn("event_coordinator", "Bob Lee");
    const coordinator2 = fake.signIn("event_coordinator", "Carol White");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: organiser.id,
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/eligible-coordinators`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((u) => u.id);
    expect(ids).toContain(coordinator.id);
    expect(ids).toContain(coordinator2.id);
    expect(ids).not.toContain(organiser.id);
  });

  it("excludes inactive coordinators", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice Johnson");
    const activeCoord = fake.signIn("event_coordinator", "Active Coord", true);
    const inactiveCoord = fake.signIn("event_coordinator", "Inactive Coord", false);

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: organiser.id,
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/eligible-coordinators`)
      .set("Cookie", activeCoord.cookie);

    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((u) => u.id);
    expect(ids).toContain(activeCoord.id);
    expect(ids).not.toContain(inactiveCoord.id);
  });

  it("returns empty array when no active coordinators exist", async () => {
    const fake = createFake();
    // Sign in as an inactive coordinator — lookUpRole only checks role so auth passes,
    // but the eligible-coordinators query filters is_active=true so the list is empty.
    const coordinator = fake.signIn("event_coordinator", "Inactive Coord", false);

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/eligible-coordinators`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns each coordinator's id and full_name", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator", "Bob Lee");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/eligible-coordinators`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: coordinator.id, full_name: "Bob Lee" });
  });

  it("returns 403 when caller is not an event_coordinator", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice Johnson");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: organiser.id,
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/eligible-coordinators`)
      .set("Cookie", organiser.cookie);

    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: organiser.id,
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/eligible-coordinators`);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-42/AC3 — Assign coordinator to event
// ---------------------------------------------------------------------------
describe("SCRUM-42/AC3 — Assign coordinator to event", () => {
  it("assigns an eligible coordinator to an unassigned event", async () => {
    const fake = createFake();
    const caller = fake.signIn("event_coordinator", "Alice Coord");
    const assignee = fake.signIn("event_coordinator", "Bob Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .set("Cookie", caller.cookie)
      .send({ coordinator_id: assignee.id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ assigned_coordinator_id: assignee.id });
    const stored = fake.tables.events.find((e) => e.id === eventId);
    expect(stored?.assigned_coordinator_id).toBe(assignee.id);
  });

  it("returns 400 if coordinator_id is missing from the request body", async () => {
    const fake = createFake();
    const caller = fake.signIn("event_coordinator");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .set("Cookie", caller.cookie)
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 404 if the coordinator does not exist", async () => {
    const fake = createFake();
    const caller = fake.signIn("event_coordinator");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .set("Cookie", caller.cookie)
      .send({ coordinator_id: crypto.randomUUID() });

    expect(res.status).toBe(404);
  });

  it("returns 404 if the coordinator is inactive", async () => {
    const fake = createFake();
    const caller = fake.signIn("event_coordinator");
    const inactive = fake.signIn("event_coordinator", "Inactive Coord", false);

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .set("Cookie", caller.cookie)
      .send({ coordinator_id: inactive.id });

    expect(res.status).toBe(404);
  });

  it("returns 404 if the target user is not an event_coordinator", async () => {
    const fake = createFake();
    const caller = fake.signIn("event_coordinator");
    const organiser = fake.signIn("event_organiser", "Bob Org");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .set("Cookie", caller.cookie)
      .send({ coordinator_id: organiser.id });

    expect(res.status).toBe(404);
  });

  it("returns 404 if the event does not exist", async () => {
    const fake = createFake();
    const caller = fake.signIn("event_coordinator");
    const assignee = fake.signIn("event_coordinator", "Bob Coord");

    const res = await request(createApp(fake.deps))
      .post(`/events/${crypto.randomUUID()}/assign-coordinator`)
      .set("Cookie", caller.cookie)
      .send({ coordinator_id: assignee.id });

    expect(res.status).toBe(404);
  });

  it("returns 403 if caller is not an event_coordinator", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: organiser.id,
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .set("Cookie", organiser.cookie)
      .send({ coordinator_id: coordinator.id });

    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .send({ coordinator_id: coordinator.id });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-42/AC4 — Coordinator's active event list
// ---------------------------------------------------------------------------
describe("SCRUM-42/AC4 — Coordinator's active event list", () => {
  it("returns events assigned to the calling coordinator", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator", "Alice Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "approved",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: coordinator.id,
    });

    const res = await request(createApp(fake.deps))
      .get("/events/my-events")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(eventId);
  });

  it("returns empty array when coordinator has no assigned events", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");

    const res = await request(createApp(fake.deps))
      .get("/events/my-events")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("does not include events assigned to other coordinators", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator", "Alice Coord");
    const other = fake.signIn("event_coordinator", "Bob Coord");

    const myEventId = crypto.randomUUID();
    const otherEventId = crypto.randomUUID();
    fake.tables.events.push(
      { id: myEventId, name: "My Event", status: "approved", organiser_id: crypto.randomUUID(), assigned_coordinator_id: coordinator.id },
      { id: otherEventId, name: "Other Event", status: "approved", organiser_id: crypto.randomUUID(), assigned_coordinator_id: other.id },
    );

    const res = await request(createApp(fake.deps))
      .get("/events/my-events")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    const ids = (res.body as { id: string }[]).map((e) => e.id);
    expect(ids).toContain(myEventId);
    expect(ids).not.toContain(otherEventId);
  });

  it("returns each event's id, name, and status", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "planning",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: coordinator.id,
    });

    const res = await request(createApp(fake.deps))
      .get("/events/my-events")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: eventId, name: "Tech Summit", status: "planning" });
  });

  it("returns 403 when caller is not an event_coordinator", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await request(createApp(fake.deps))
      .get("/events/my-events")
      .set("Cookie", organiser.cookie);

    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(createApp(createFake().deps))
      .get("/events/my-events");

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-42/AC5 — Coordinator as organiser's point of contact
// ---------------------------------------------------------------------------
describe("SCRUM-42/AC5 — Coordinator as organiser's point of contact", () => {
  it("includes the assigned coordinator's name as point_of_contact_name when an organiser views the event", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice Org");
    const coordinator = fake.signIn("event_coordinator", "Bob Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "approved",
      organiser_id: organiser.id,
      assigned_coordinator_id: coordinator.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}`)
      .set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ point_of_contact_name: "Bob Coord" });
  });

  it("returns null point_of_contact_name when no coordinator is assigned", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice Org");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      organiser_id: organiser.id,
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}`)
      .set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body.point_of_contact_name).toBeNull();
  });

  it("also includes point_of_contact_name when a coordinator views the event", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator", "Bob Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "approved",
      organiser_id: organiser.id,
      assigned_coordinator_id: coordinator.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ point_of_contact_name: "Bob Coord" });
  });
});
