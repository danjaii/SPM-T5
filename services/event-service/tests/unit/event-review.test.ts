import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fake Supabase — supports both list (direct await) and single (maybeSingle)
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function createFake() {
  const sessions = new Map<string, string>();
  const tables: Record<string, Row[]> = { users: [], events: [] };

  const makeQuery = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const orClauses: string[] = [];

    const applyFilters = () => {
      let rows = (tables[table] ?? []).filter((r) => filters.every(([col, val]) => r[col] === val));
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
      maybeSingle: (): Promise<{ data: Row | null; error: null }> => {
        const rows = applyFilters();
        return Promise.resolve({ data: rows[0] ? { ...rows[0] } : null, error: null });
      },
      then<T>(
        onFulfilled?: ((v: { data: Row[]; error: null }) => T | PromiseLike<T>) | null,
        onRejected?: ((e: unknown) => T | PromiseLike<T>) | null,
      ): Promise<T> {
        const rows = applyFilters();
        const enriched =
          table === "events"
            ? rows.map((r) => {
                const organiser = tables.users.find((u) => u.id === r.organiser_id);
                return { ...r, organiser: organiser ? { full_name: organiser.full_name } : null };
              })
            : rows.map((r) => ({ ...r }));
        return Promise.resolve({ data: enriched, error: null as null }).then(onFulfilled, onRejected);
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
    forUser: (token: string) => ({
      from: (table: string) => makeQuery(table),
      rpc: (_fn: string, _args: Row) => ({
        maybeSingle: async () => ({ data: null, error: null }),
      }),
    }),
  } as unknown as SupabaseDeps;

  const signIn = (role: string, fullName = "Test User") => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: fullName, is_active: true });
    sessions.set(`token-${id}`, id);
    return { id, cookie: `cs_session=token-${id}` };
  };

  return { deps, tables, signIn };
}

// ---------------------------------------------------------------------------
// SCRUM-22/AC1 — View submitted requests
// ---------------------------------------------------------------------------
describe("SCRUM-22/AC1 — View submitted requests", () => {
  it("returns submitted events with organiser name, event name, submission date and status for a coordinator", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    const event = {
      id: crypto.randomUUID(),
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps))
      .get("/events")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: event.id,
        name: "Tech Summit",
        status: "submitted",
        submitted_at: "2026-09-01T10:00:00.000Z",
        organiser_name: "Test User",
      },
    ]);
  });

  it("excludes draft events from the list", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push({
      id: crypto.randomUUID(),
      name: "Draft Event",
      status: "draft",
      submitted_at: null,
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get("/events")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("refuses a non-coordinator with 403", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const res = await request(createApp(fake.deps))
      .get("/events")
      .set("Cookie", organiser.cookie);

    expect(res.status).toBe(403);
  });

  it("refuses an unauthenticated request with 401", async () => {
    const fake = createFake();

    const res = await request(createApp(fake.deps)).get("/events");

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-22/AC2 — Default request visibility
// ---------------------------------------------------------------------------
describe("SCRUM-22/AC2 — Default request visibility", () => {
  it("shows events assigned to the calling coordinator", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");
    const otherCoord = fake.signIn("event_coordinator");

    const myEvent = {
      id: crypto.randomUUID(),
      name: "My Event",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
      assigned_coordinator_id: coordinator.id,
    };
    const theirEvent = {
      id: crypto.randomUUID(),
      name: "Their Event",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
      assigned_coordinator_id: otherCoord.id,
    };
    fake.tables.events.push(myEvent, theirEvent);

    const res = await request(createApp(fake.deps))
      .get("/events")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(myEvent.id);
  });

  it("also shows unassigned events alongside the coordinator's own assigned events", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");
    const otherCoord = fake.signIn("event_coordinator");

    const myEvent = {
      id: crypto.randomUUID(),
      name: "My Event",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
      assigned_coordinator_id: coordinator.id,
    };
    const unassignedEvent = {
      id: crypto.randomUUID(),
      name: "Unassigned Event",
      status: "submitted",
      submitted_at: "2026-09-02T10:00:00.000Z",
      organiser_id: organiser.id,
      assigned_coordinator_id: null,
    };
    const theirEvent = {
      id: crypto.randomUUID(),
      name: "Their Event",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
      assigned_coordinator_id: otherCoord.id,
    };
    fake.tables.events.push(myEvent, unassignedEvent, theirEvent);

    const res = await request(createApp(fake.deps))
      .get("/events")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const ids = res.body.map((e: { id: string }) => e.id);
    expect(ids).toContain(myEvent.id);
    expect(ids).toContain(unassignedEvent.id);
  });

  it("hides events assigned to a different coordinator", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");
    const otherCoord = fake.signIn("event_coordinator");

    fake.tables.events.push({
      id: crypto.randomUUID(),
      name: "Other Event",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
      assigned_coordinator_id: otherCoord.id,
    });

    const res = await request(createApp(fake.deps))
      .get("/events")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-22/AC3 — Search requests
// ---------------------------------------------------------------------------
describe("SCRUM-22/AC3 — Search requests", () => {
  it("filters by event name (partial, case-insensitive)", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Tech Summit 2026", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Art Fair", status: "submitted", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?search=tech")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Tech Summit 2026");
  });

  it("filters by organiser name (partial, case-insensitive)", async () => {
    const fake = createFake();
    const organiser1 = fake.signIn("event_organiser", "Alice Johnson");
    const organiser2 = fake.signIn("event_organiser", "Bob Smith");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Event A", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser1.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Event B", status: "submitted", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser2.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?search=alice")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Event A");
  });

  it("returns all visible events when no search term is given", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Event A", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Event B", status: "submitted", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("returns an empty list when no events match the search term", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push({
      id: crypto.randomUUID(),
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
      assigned_coordinator_id: null,
    });

    const res = await request(createApp(fake.deps))
      .get("/events?search=xyz")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-22/AC4 — Filter by status
// ---------------------------------------------------------------------------
describe("SCRUM-22/AC4 — Filter by status", () => {
  it("filters by a single explicit status", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Submitted Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Under Review Event", status: "under_review", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?status=under_review")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Under Review Event");
  });

  it("filters by multiple statuses", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Submitted Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Under Review Event", status: "under_review", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Approved Event", status: "approved", submitted_at: "2026-09-03T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?status=submitted&status=under_review")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const names = res.body.map((e: { name: string }) => e.name);
    expect(names).toContain("Submitted Event");
    expect(names).toContain("Under Review Event");
  });

  it("defaults to submitted events when no status param is given", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Submitted Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Under Review Event", status: "under_review", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Submitted Event");
  });
});

// ---------------------------------------------------------------------------
// SCRUM-22/AC5 — Filter by submission date
// ---------------------------------------------------------------------------
describe("SCRUM-22/AC5 — Filter by submission date", () => {
  it("filters events by start date (from)", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Early Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Late Event", status: "submitted", submitted_at: "2026-09-03T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?from=2026-09-02")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Late Event");
  });

  it("filters events by end date (to)", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Early Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Late Event", status: "submitted", submitted_at: "2026-09-03T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?to=2026-09-02")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Early Event");
  });

  it("filters events by date range (from and to)", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Event 1 Sep", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Event 2 Sep", status: "submitted", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Event 3 Sep", status: "submitted", submitted_at: "2026-09-03T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?from=2026-09-01&to=2026-09-02")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const names = res.body.map((e: { name: string }) => e.name);
    expect(names).toContain("Event 1 Sep");
    expect(names).toContain("Event 2 Sep");
  });

  it("returns all visible events when no date params are given", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Event A", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Event B", status: "submitted", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-22/AC6 — Combine search and filters
// ---------------------------------------------------------------------------
describe("SCRUM-22/AC6 — Combine search and filters", () => {
  it("applies search and status filter together (AND logic)", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Tech Summit", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Tech Gala", status: "under_review", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Art Fair", status: "submitted", submitted_at: "2026-09-03T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?search=tech&status=submitted")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Tech Summit");
  });

  it("applies status and date filters together", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Old Submitted", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "New Submitted", status: "submitted", submitted_at: "2026-09-05T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "New Review", status: "under_review", submitted_at: "2026-09-05T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?status=submitted&from=2026-09-03")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("New Submitted");
  });

  it("applies search, status, and date range all at once", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Tech Summit Sep1", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Tech Summit Sep5", status: "submitted", submitted_at: "2026-09-05T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Tech Gala Sep1", status: "under_review", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
      { id: crypto.randomUUID(), name: "Art Fair Sep1", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?search=tech&status=submitted&from=2026-09-01&to=2026-09-02")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Tech Summit Sep1");
  });
});