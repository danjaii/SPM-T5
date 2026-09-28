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
  const tables: Record<string, Row[]> = { users: [], events: [], room_layouts: [], event_comments: [] };

  const makeQuery = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const orClauses: string[] = [];
    let orderCol: string | null = null;
    let orderAsc = true;

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
      if (orderCol) {
        const col = orderCol;
        const asc = orderAsc;
        rows = [...rows].sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
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
      order: (col: string, opts?: { ascending?: boolean }) => {
        orderCol = col;
        orderAsc = opts?.ascending !== false;
        return builder;
      },
      insert: (row: Row | Row[]) => {
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) {
          (tables[table] ??= []).push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r });
        }
        return Promise.resolve({ data: rows, error: null });
      },
      maybeSingle: (): Promise<{ data: Row | null; error: null }> => {
        const rows = applyFilters();
        if (!rows[0]) return Promise.resolve({ data: null, error: null });
        const row = { ...rows[0] };
        if (table === "events") {
          const organiser = tables.users.find((u) => u.id === row.organiser_id);
          row.organiser = organiser ? { full_name: organiser.full_name } : null;
          const layout = tables.room_layouts.find((l) => l.id === row.preferred_room_layout_id);
          row.preferred_room_layout = layout ? { name: layout.name } : null;
        }
        return Promise.resolve({ data: row, error: null });
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
            : table === "event_comments"
            ? rows.map((r) => {
                const author = tables.users.find((u) => u.id === r.author_id);
                return { ...r, author: author ? { full_name: author.full_name } : null };
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
      rpc: (_fn: string, args: Row) => ({
        maybeSingle: async () => {
          if (_fn === "change_event_status") {
            const event = tables.events.find((e) => e.id === args.p_event_id);
            if (!event) return { data: null, error: null };
            event.status = args.p_new_status;
            return { data: { id: event.id, name: event.name, status: event.status }, error: null };
          }
          return { data: null, error: null };
        },
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

// ---------------------------------------------------------------------------
// SCRUM-23/AC1 — Open a request
// ---------------------------------------------------------------------------
describe("SCRUM-23/AC1 — Open a request", () => {
  it("returns the full details of a submitted event request for a coordinator", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice Johnson");
    const coordinator = fake.signIn("event_coordinator");

    const layoutId = crypto.randomUUID();
    fake.tables.room_layouts.push({ id: layoutId, name: "Theatre" });

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      purpose: "Annual technology conference",
      preferred_start_datetime: "2026-10-01T09:00:00.000Z",
      preferred_end_datetime: "2026-10-01T17:00:00.000Z",
      expected_attendance: 200,
      preferred_room_layout_id: layoutId,
      accessibility_requirements: "Wheelchair access required",
      equipment_requirements_notes: "Projector and microphone",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      purpose: "Annual technology conference",
      preferred_start_datetime: "2026-10-01T09:00:00.000Z",
      preferred_end_datetime: "2026-10-01T17:00:00.000Z",
      expected_attendance: 200,
      preferred_layout_name: "Theatre",
      accessibility_requirements: "Wheelchair access required",
      equipment_requirements_notes: "Projector and microphone",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_name: "Alice Johnson",
    });
  });

  it("returns null for optional fields when they are not set", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Bob Smith");
    const coordinator = fake.signIn("event_coordinator");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Minimal Event",
      status: "submitted",
      purpose: null,
      preferred_start_datetime: null,
      preferred_end_datetime: null,
      expected_attendance: null,
      preferred_room_layout_id: null,
      accessibility_requirements: null,
      equipment_requirements_notes: null,
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: eventId,
      name: "Minimal Event",
      status: "submitted",
      purpose: null,
      preferred_start_datetime: null,
      preferred_end_datetime: null,
      expected_attendance: null,
      preferred_layout_name: null,
      accessibility_requirements: null,
      equipment_requirements_notes: null,
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_name: "Bob Smith",
    });
  });
});

// ---------------------------------------------------------------------------
// SCRUM-23/AC2 — View event details
// ---------------------------------------------------------------------------
describe("SCRUM-23/AC2 — View event details", () => {
  it("returns all required detail fields for an open submitted event request", async () => {
    // AC2 field checklist: organiser name, event name, purpose, datetime range,
    // expected attendance, layout preference, accessibility needs, equipment needs,
    // submission date, current status.
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Carol White");
    const coordinator = fake.signIn("event_coordinator");

    const layoutId = crypto.randomUUID();
    fake.tables.room_layouts.push({ id: layoutId, name: "Classroom" });

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Leadership Workshop",
      status: "under_review",
      purpose: "Team leadership development",
      preferred_start_datetime: "2026-11-15T09:00:00.000Z",
      preferred_end_datetime: "2026-11-15T12:00:00.000Z",
      expected_attendance: 30,
      preferred_room_layout_id: layoutId,
      accessibility_requirements: "Hearing loop required",
      equipment_requirements_notes: "Laptop and projector",
      submitted_at: "2026-09-15T08:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body.organiser_name).toBe("Carol White");
    expect(res.body.name).toBe("Leadership Workshop");
    expect(res.body.purpose).toBe("Team leadership development");
    expect(res.body.preferred_start_datetime).toBe("2026-11-15T09:00:00.000Z");
    expect(res.body.preferred_end_datetime).toBe("2026-11-15T12:00:00.000Z");
    expect(res.body.expected_attendance).toBe(30);
    expect(res.body.preferred_layout_name).toBe("Classroom");
    expect(res.body.accessibility_requirements).toBe("Hearing loop required");
    expect(res.body.equipment_requirements_notes).toBe("Laptop and projector");
    expect(res.body.submitted_at).toBe("2026-09-15T08:00:00.000Z");
    expect(res.body.status).toBe("under_review");
  });

  it("exposes layout preference as a resolved name, not a raw foreign-key ID", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    const layoutId = crypto.randomUUID();
    fake.tables.room_layouts.push({ id: layoutId, name: "Boardroom" });

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Board Meeting",
      status: "submitted",
      purpose: null,
      preferred_start_datetime: null,
      preferred_end_datetime: null,
      expected_attendance: null,
      preferred_room_layout_id: layoutId,
      accessibility_requirements: null,
      equipment_requirements_notes: null,
      submitted_at: "2026-09-20T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body.preferred_layout_name).toBe("Boardroom");
    expect(res.body).not.toHaveProperty("preferred_room_layout_id");
  });
});

// ---------------------------------------------------------------------------
// SCRUM-23/AC3 — Missing optional information
// ---------------------------------------------------------------------------
describe("SCRUM-23/AC3 — Missing optional information", () => {
  it("returns null for every optional field when the organiser left them blank", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Bare Event",
      status: "submitted",
      purpose: null,
      preferred_start_datetime: null,
      preferred_end_datetime: null,
      expected_attendance: null,
      preferred_room_layout_id: null,
      accessibility_requirements: null,
      equipment_requirements_notes: null,
      submitted_at: "2026-09-20T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    // Each optional field must be explicitly present as null — not omitted, not undefined.
    expect(res.body).toHaveProperty("purpose", null);
    expect(res.body).toHaveProperty("preferred_start_datetime", null);
    expect(res.body).toHaveProperty("preferred_end_datetime", null);
    expect(res.body).toHaveProperty("expected_attendance", null);
    expect(res.body).toHaveProperty("preferred_layout_name", null);
    expect(res.body).toHaveProperty("accessibility_requirements", null);
    expect(res.body).toHaveProperty("equipment_requirements_notes", null);
  });

  it("returns null for organiser_name when the organiser profile has no full_name", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "");
    const coordinator = fake.signIn("event_coordinator");

    // Blank full_name on the user record
    const userRow = fake.tables.users.find((u) => u.id === organiser.id);
    if (userRow) userRow.full_name = null as unknown as string;

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Nameless Organiser Event",
      status: "submitted",
      submitted_at: "2026-09-20T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("organiser_name", null);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-23/AC4 — Access control
// ---------------------------------------------------------------------------
describe("SCRUM-23/AC4 — Access control", () => {
  it("returns 403 when a venue_staff member attempts to view a specific event", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const venueStaff = fake.signIn("venue_staff");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Restricted Event",
      status: "submitted",
      submitted_at: "2026-09-20T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}`)
      .set("Cookie", venueStaff.cookie);

    expect(res.status).toBe(403);
  });

  it("returns 403 when an attendee attempts to view a specific event", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const attendee = fake.signIn("attendee");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Restricted Event",
      status: "submitted",
      submitted_at: "2026-09-20T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}`)
      .set("Cookie", attendee.cookie);

    expect(res.status).toBe(403);
  });

  it("returns 404 when an organiser attempts to view another organiser's event", async () => {
    const fake = createFake();
    const organiserA = fake.signIn("event_organiser");
    const organiserB = fake.signIn("event_organiser");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Organiser A Event",
      status: "submitted",
      submitted_at: "2026-09-20T10:00:00.000Z",
      organiser_id: organiserA.id,
    });

    // organiserB requests organiserA's event — must be indistinguishable from not found
    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}`)
      .set("Cookie", organiserB.cookie);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-22/AC7 — No matching requests
// ---------------------------------------------------------------------------
describe("SCRUM-22/AC7 — No matching requests", () => {
  it("returns empty array when search term matches nothing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Tech Summit", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?search=xyz")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns empty array when status filter matches no events", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Submitted Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?status=approved")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns empty array when date range excludes all events", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Sep Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?from=2026-10-01")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns empty array when combined filters match nothing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    fake.tables.events.push(
      { id: crypto.randomUUID(), name: "Tech Summit", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: null },
    );

    const res = await request(createApp(fake.deps))
      .get("/events?search=tech&status=approved")
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-24/AC2 — Reject a request
// ---------------------------------------------------------------------------
describe("SCRUM-24/AC2 — Reject a request", () => {
  it("updates the event status to 'rejected' when a coordinator rejects it with a reason", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    const eventId = crypto.randomUUID();
    const event = {
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/reject`)
      .set("Cookie", coordinator.cookie)
      .send({ reason: "Venue not available on requested dates." });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(event.status).toBe("rejected");
  });

  it("returns 400 when no reason is provided", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/reject`)
      .set("Cookie", coordinator.cookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 403 when a non-coordinator attempts to reject an event", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/reject`)
      .set("Cookie", organiser.cookie)
      .send({ reason: "Testing unauthorized rejection." });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-24/AC1 — Approve a request
// ---------------------------------------------------------------------------
describe("SCRUM-24/AC1 — Approve a request", () => {
  it("updates the event status to 'approved' when a coordinator approves it", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    const eventId = crypto.randomUUID();
    const event = {
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/approve`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(event.status).toBe("approved");
  });
});

// ---------------------------------------------------------------------------
// SCRUM-25/AC1 — Add a comment
// ---------------------------------------------------------------------------
describe("SCRUM-25/AC1 — Add a comment", () => {
  it("saves a comment and returns 201 when a coordinator posts to an event", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: "Please provide more details." });

    expect(res.status).toBe(201);
    expect(fake.tables.event_comments).toHaveLength(1);
    expect(fake.tables.event_comments[0]).toMatchObject({
      event_id: eventId,
      author_id: coordinator.id,
      body: "Please provide more details.",
    });
  });

  it("returns 403 when an attendee attempts to add a comment", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const attendee = fake.signIn("attendee");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", attendee.cookie)
      .send({ body: "I want to comment." });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-25/AC2 — Display comment details
// ---------------------------------------------------------------------------
describe("SCRUM-25/AC2 — Display comment details", () => {
  it("returns each comment with author_name, created_at, and body", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice Tan");
    const coordinator = fake.signIn("event_coordinator", "Bob Lee");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const app = createApp(fake.deps);
    await request(app)
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: "Please provide more details." });

    const res = await request(app)
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      author_name: "Bob Lee",
      body: "Please provide more details.",
    });
    expect(res.body[0].created_at).toBeDefined();
  });

  it("returns 403 when an attendee attempts to view comments", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const attendee = fake.signIn("attendee");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", attendee.cookie);

    expect(res.status).toBe(403);
  });
});

describe("SCRUM-25/AC3 — View comment history", () => {
  it("returns comments ordered oldest to newest", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator", "Bob Lee");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    // Seed three comments with explicit timestamps out-of-order in the array
    fake.tables.event_comments = [
      {
        id: crypto.randomUUID(),
        event_id: eventId,
        author_id: coordinator.id,
        body: "Third comment",
        created_at: "2026-09-03T12:00:00.000Z",
      },
      {
        id: crypto.randomUUID(),
        event_id: eventId,
        author_id: coordinator.id,
        body: "First comment",
        created_at: "2026-09-01T12:00:00.000Z",
      },
      {
        id: crypto.randomUUID(),
        event_id: eventId,
        author_id: coordinator.id,
        body: "Second comment",
        created_at: "2026-09-02T12:00:00.000Z",
      },
    ];

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].body).toBe("First comment");
    expect(res.body[1].body).toBe("Second comment");
    expect(res.body[2].body).toBe("Third comment");
  });
});

describe("SCRUM-25/AC4 — Prevent empty comments", () => {
  it("returns 400 when body is empty string", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator", "Bob Lee");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 when body is whitespace only", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator", "Bob Lee");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: "   " });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});
