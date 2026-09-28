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

  const signIn = (role: string) => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: "Test User", is_active: true });
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
