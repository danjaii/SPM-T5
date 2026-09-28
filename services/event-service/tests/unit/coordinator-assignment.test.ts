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
  const tables: Record<string, Row[]> = { users: [], events: [], coordinator_assignment_logs: [] };

  const makeQuery = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const orClauses: string[] = [];
    let pendingUpdate: Row | null = null;
    let pendingInsert: Row | null = null;

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

    let orderCol: string | null = null;
    let orderAsc = true;

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
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending ?? true;
        return builder;
      },
      update: (patch: Row) => {
        pendingUpdate = patch;
        return builder;
      },
      insert: (row: Row) => {
        pendingInsert = row;
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
        if (pendingInsert !== null) {
          const row = pendingInsert;
          (tables[table] ??= []).push(row);
          return Promise.resolve({ data: [row], error: null as null }).then(onFulfilled, onRejected);
        }
        if (pendingUpdate !== null) {
          const patch = pendingUpdate;
          const rows = applyFilters();
          for (const row of rows) Object.assign(row, patch);
          return Promise.resolve({ data: rows, error: null as null }).then(onFulfilled, onRejected);
        }
        let rows = applyFilters().map((r) => ({ ...r }));
        if (orderCol) {
          const col = orderCol;
          const asc = orderAsc;
          rows = rows.sort((a, b) => {
            const av = String(a[col] ?? "");
            const bv = String(b[col] ?? "");
            return asc ? av.localeCompare(bv) : bv.localeCompare(av);
          });
        }
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

// ---------------------------------------------------------------------------
// SCRUM-42/AC6 — Record assignment
// ---------------------------------------------------------------------------
describe("SCRUM-42/AC6 — Record assignment", () => {
  it("inserts a log entry with event_id, coordinator_id, assigned_by, and assigned_at on successful assignment", async () => {
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

    const before = new Date();
    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .set("Cookie", caller.cookie)
      .send({ coordinator_id: assignee.id });
    const after = new Date();

    expect(res.status).toBe(200);
    const logs = fake.tables.coordinator_assignment_logs;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      event_id: eventId,
      coordinator_id: assignee.id,
      assigned_by: caller.id,
    });
    const assignedAt = new Date(logs[0].assigned_at as string);
    expect(assignedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(assignedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("does not create a log entry when the coordinator is not found", async () => {
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
    expect(fake.tables.coordinator_assignment_logs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-43/AC1 — View assignment history
// ---------------------------------------------------------------------------
describe("SCRUM-43/AC1 — View assignment history", () => {
  it("returns assignment history for an event the caller is authorised to view", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator", "Alice Coord");
    const assignee = fake.signIn("event_coordinator", "Bob Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "approved",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: assignee.id,
    });
    fake.tables.coordinator_assignment_logs.push({
      id: crypto.randomUUID(),
      event_id: eventId,
      coordinator_id: assignee.id,
      assigned_by: coordinator.id,
      assigned_at: "2026-09-01T10:00:00.000Z",
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/assignment-history`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      event_id: eventId,
      coordinator_id: assignee.id,
      assigned_by: coordinator.id,
    });
  });

  it("returns empty array when no assignments have been made", async () => {
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
      .get(`/events/${eventId}/assignment-history`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("also allows an event_organiser to view the assignment history", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice Org");
    const assignee = fake.signIn("event_coordinator", "Bob Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "approved",
      organiser_id: organiser.id,
      assigned_coordinator_id: assignee.id,
    });
    fake.tables.coordinator_assignment_logs.push({
      id: crypto.randomUUID(),
      event_id: eventId,
      coordinator_id: assignee.id,
      assigned_by: organiser.id,
      assigned_at: "2026-09-01T10:00:00.000Z",
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/assignment-history`)
      .set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("returns 403 when caller is not authorised to view events", async () => {
    const fake = createFake();
    const attendee = fake.signIn("attendee");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "approved",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/assignment-history`)
      .set("Cookie", attendee.cookie);

    expect(res.status).toBe(403);
  });

  it("returns 401 when unauthenticated", async () => {
    const fake = createFake();
    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "approved",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/assignment-history`);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-43/AC2 — Display assignment information
// ---------------------------------------------------------------------------
describe("SCRUM-43/AC2 — Display assignment information", () => {
  it("returns previous_coordinator_id as null for an initial assignment", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator", "Alice Coord");
    const assignee = fake.signIn("event_coordinator", "Bob Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "approved",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: assignee.id,
    });
    fake.tables.coordinator_assignment_logs.push({
      id: crypto.randomUUID(),
      event_id: eventId,
      coordinator_id: assignee.id,
      previous_coordinator_id: null,
      assigned_by: coordinator.id,
      assigned_at: "2026-09-01T10:00:00.000Z",
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/assignment-history`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].previous_coordinator_id).toBeNull();
  });

  it("returns previous_coordinator_id when a coordinator was previously assigned", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator", "Alice Coord");
    const previousAssignee = fake.signIn("event_coordinator", "Carol Coord");
    const newAssignee = fake.signIn("event_coordinator", "Bob Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "approved",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: newAssignee.id,
    });
    fake.tables.coordinator_assignment_logs.push({
      id: crypto.randomUUID(),
      event_id: eventId,
      coordinator_id: newAssignee.id,
      previous_coordinator_id: previousAssignee.id,
      assigned_by: coordinator.id,
      assigned_at: "2026-09-02T10:00:00.000Z",
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/assignment-history`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].previous_coordinator_id).toBe(previousAssignee.id);
  });

  it("records previous_coordinator_id from the event when assigning a coordinator", async () => {
    const fake = createFake();
    const caller = fake.signIn("event_coordinator", "Alice Coord");
    const existing = fake.signIn("event_coordinator", "Carol Coord");
    const newAssignee = fake.signIn("event_coordinator", "Bob Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "approved",
      organiser_id: crypto.randomUUID(),
      assigned_coordinator_id: existing.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .set("Cookie", caller.cookie)
      .send({ coordinator_id: newAssignee.id });

    expect(res.status).toBe(200);
    const logs = fake.tables.coordinator_assignment_logs;
    expect(logs).toHaveLength(1);
    expect(logs[0].previous_coordinator_id).toBe(existing.id);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-43/AC4 — Preserve historical records
// ---------------------------------------------------------------------------
describe("SCRUM-43/AC4 — Preserve historical records", () => {
  it("returns both records after two successive assignments to the same event", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator", "Alice Coord");
    const assignee1 = fake.signIn("event_coordinator", "Bob Coord");
    const assignee2 = fake.signIn("event_coordinator", "Carol Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      organiser_id: crypto.randomUUID(), assigned_coordinator_id: null,
    });

    // First assignment
    const res1 = await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .set("Cookie", coordinator.cookie)
      .send({ coordinator_id: assignee1.id });
    expect(res1.status).toBe(200);

    // Second assignment — reassign to a different coordinator
    const res2 = await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .set("Cookie", coordinator.cookie)
      .send({ coordinator_id: assignee2.id });
    expect(res2.status).toBe(200);

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/assignment-history`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("does not overwrite the first record when a second assignment is made", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator", "Alice Coord");
    const assignee1 = fake.signIn("event_coordinator", "Bob Coord");
    const assignee2 = fake.signIn("event_coordinator", "Carol Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      organiser_id: crypto.randomUUID(), assigned_coordinator_id: null,
    });

    await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .set("Cookie", coordinator.cookie)
      .send({ coordinator_id: assignee1.id });

    await request(createApp(fake.deps))
      .post(`/events/${eventId}/assign-coordinator`)
      .set("Cookie", coordinator.cookie)
      .send({ coordinator_id: assignee2.id });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/assignment-history`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // The first record must still record assignee1 as coordinator (not overwritten)
    const first = res.body.find((r: { coordinator_id: string }) => r.coordinator_id === assignee1.id);
    expect(first).toBeDefined();
    expect(first.previous_coordinator_id).toBeNull();
    // The second record records the reassignment to assignee2 with assignee1 as previous
    const second = res.body.find((r: { coordinator_id: string }) => r.coordinator_id === assignee2.id);
    expect(second).toBeDefined();
    expect(second.previous_coordinator_id).toBe(assignee1.id);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-43/AC3 — Display history chronologically
// ---------------------------------------------------------------------------
describe("SCRUM-43/AC3 — Display history chronologically", () => {
  it("returns records sorted oldest-first regardless of insertion order", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator", "Alice Coord");
    const assignee1 = fake.signIn("event_coordinator", "Bob Coord");
    const assignee2 = fake.signIn("event_coordinator", "Carol Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "approved",
      organiser_id: crypto.randomUUID(), assigned_coordinator_id: assignee2.id,
    });
    // Insert newer record first — without sorting the route returns them in this order
    fake.tables.coordinator_assignment_logs.push({
      id: crypto.randomUUID(), event_id: eventId, coordinator_id: assignee2.id,
      previous_coordinator_id: assignee1.id, assigned_by: coordinator.id,
      assigned_at: "2026-09-02T10:00:00.000Z",
    });
    fake.tables.coordinator_assignment_logs.push({
      id: crypto.randomUUID(), event_id: eventId, coordinator_id: assignee1.id,
      previous_coordinator_id: null, assigned_by: coordinator.id,
      assigned_at: "2026-09-01T10:00:00.000Z",
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/assignment-history`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].assigned_at).toBe("2026-09-01T10:00:00.000Z");
    expect(res.body[1].assigned_at).toBe("2026-09-02T10:00:00.000Z");
  });

  it("returns three records in chronological order when inserted out of sequence", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator", "Alice Coord");
    const a = fake.signIn("event_coordinator", "A Coord");
    const b = fake.signIn("event_coordinator", "B Coord");
    const c = fake.signIn("event_coordinator", "C Coord");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "approved",
      organiser_id: crypto.randomUUID(), assigned_coordinator_id: c.id,
    });
    // Insert in order: third, first, second
    fake.tables.coordinator_assignment_logs.push(
      { id: crypto.randomUUID(), event_id: eventId, coordinator_id: c.id, previous_coordinator_id: b.id, assigned_by: coordinator.id, assigned_at: "2026-09-03T10:00:00.000Z" },
      { id: crypto.randomUUID(), event_id: eventId, coordinator_id: a.id, previous_coordinator_id: null, assigned_by: coordinator.id, assigned_at: "2026-09-01T10:00:00.000Z" },
      { id: crypto.randomUUID(), event_id: eventId, coordinator_id: b.id, previous_coordinator_id: a.id, assigned_by: coordinator.id, assigned_at: "2026-09-02T10:00:00.000Z" },
    );

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/assignment-history`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].assigned_at).toBe("2026-09-01T10:00:00.000Z");
    expect(res.body[1].assigned_at).toBe("2026-09-02T10:00:00.000Z");
    expect(res.body[2].assigned_at).toBe("2026-09-03T10:00:00.000Z");
  });
});
