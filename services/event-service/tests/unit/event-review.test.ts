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
  const tables: Record<string, Row[]> = { users: [], events: [], room_layouts: [], event_categories: [], event_comments: [], event_comment_mentions: [], event_comment_attachments: [], event_status_history: [] };
  const rpcCalls: Array<{ fn: string; args: Row }> = [];

  const makeQuery = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const orClauses: string[] = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    const inFilters: Array<[string, unknown[]]> = [];

    const applyFilters = () => {
      let rows = (tables[table] ?? []).filter(
        (r) =>
          filters.every(([col, val]) => r[col] === val) &&
          inFilters.every(([col, vals]) => vals.includes(r[col])),
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
      in: (col: string, vals: unknown[]) => {
        inFilters.push([col, vals]);
        return builder;
      },
      or: (filter: string) => {
        orClauses.push(filter);
        return builder;
      },
      limit: (_n: number) => builder,
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
          // SCRUM-111/AC5: the category's name
          const category = tables.event_categories.find((c) => c.id === row.event_category_id);
          row.category = category ? { name: category.name } : null;
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
        // SCRUM-47: post_event_comment (migration 44) saves the comment and its mentions together, as the caller
        then<T>(onFulfilled?: ((v: { data: unknown; error: { code: string; message: string } | null }) => T | PromiseLike<T>) | null) {
          rpcCalls.push({ fn: _fn, args });
          let data: unknown = null;
          // a mention of "refused-…" stands in for migration 08's mention policy saying no (the whole call rolls back)
          if (_fn === "post_event_comment" && (args.p_mentions as string[]).some((m) => m.startsWith("refused-"))) {
            return Promise.resolve({ data: null, error: { code: "42501", message: "new row violates row-level security policy" } }).then(onFulfilled);
          }
          if (_fn === "post_event_comment") {
            const id = crypto.randomUUID();
            tables.event_comments.push({
              id,
              event_id: args.p_event_id,
              author_id: sessions.get(token),
              comment_text: args.p_body,
              parent_comment_id: args.p_parent_comment_id,
              is_clarification_request: args.p_clarification_request ?? false,
              created_at: new Date().toISOString(),
            });
            for (const userId of args.p_mentions as string[]) tables.event_comment_mentions.push({ comment_id: id, user_id: userId });
            data = id;
          }
          return Promise.resolve({ data, error: null as null }).then(onFulfilled);
        },
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
      storage: {
        from: (_bucket: string) => ({
          createSignedUrl: async (path: string, _expiresIn: number) => ({
            data: { signedUrl: `https://fake-storage/${path}?token=signed` },
            error: null,
          }),
          // SCRUM-28/AC1: a path under "refused/" stands in for the bucket's insert policy saying no
          createSignedUploadUrl: async (path: string) =>
            path.startsWith("refused/")
              ? { data: null, error: { message: "new row violates row-level security policy" } }
              : { data: { signedUrl: `https://fake-storage/upload/${path}?token=up`, token: "up", path }, error: null },
        }),
      },
    }),
  } as unknown as SupabaseDeps;

  const signIn = (role: string, fullName = "Test User") => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: fullName, is_active: true });
    sessions.set(`token-${id}`, id);
    return { id, cookie: `cs_session=token-${id}` };
  };

  return { deps, tables, signIn, rpcCalls };
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
      assigned_coordinator_id: coordinator.id,
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

  it("SCRUM-126/AC4 shows only the events assigned to the coordinator, not unassigned ones", async () => {
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
    expect(res.body.map((e: { id: string }) => e.id)).toEqual([myEvent.id]);
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
      { id: crypto.randomUUID(), name: "Tech Summit 2026", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Art Fair", status: "submitted", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Event A", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser1.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Event B", status: "submitted", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser2.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Event A", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Event B", status: "submitted", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      assigned_coordinator_id: coordinator.id,
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
      { id: crypto.randomUUID(), name: "Submitted Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Under Review Event", status: "under_review", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Submitted Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Under Review Event", status: "under_review", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Approved Event", status: "approved", submitted_at: "2026-09-03T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Submitted Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Under Review Event", status: "under_review", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Early Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Late Event", status: "submitted", submitted_at: "2026-09-03T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Early Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Late Event", status: "submitted", submitted_at: "2026-09-03T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Event 1 Sep", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Event 2 Sep", status: "submitted", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Event 3 Sep", status: "submitted", submitted_at: "2026-09-03T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Event A", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Event B", status: "submitted", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Tech Summit", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Tech Gala", status: "under_review", submitted_at: "2026-09-02T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Art Fair", status: "submitted", submitted_at: "2026-09-03T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Old Submitted", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "New Submitted", status: "submitted", submitted_at: "2026-09-05T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "New Review", status: "under_review", submitted_at: "2026-09-05T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Tech Summit Sep1", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Tech Summit Sep5", status: "submitted", submitted_at: "2026-09-05T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Tech Gala Sep1", status: "under_review", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
      { id: crypto.randomUUID(), name: "Art Fair Sep1", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      point_of_contact_name: null,
      previous_status: null,
      description: null, // SCRUM-111/AC5
      category_name: null,
      venue_requirements: null,
      canEdit: false, // SCRUM-111/AC7: this coordinator is not the assigned one
      canChangeStatus: false, // SCRUM-8: this coordinator is not the assigned one
      canReview: false, // SCRUM-24/AC5: only the assigned coordinator may approve or reject
      isOrganiser: false, // SCRUM-66
      canRequestChange: false, // SCRUM-66: only an organiser may
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
      point_of_contact_name: null,
      previous_status: null,
      description: null, // SCRUM-111/AC5
      category_name: null,
      venue_requirements: null,
      canEdit: false, // SCRUM-111/AC7
      canChangeStatus: false, // SCRUM-8: this coordinator is not the assigned one
      canReview: false, // SCRUM-24/AC5: only the assigned coordinator may approve or reject
      isOrganiser: false, // SCRUM-66
      canRequestChange: false, // SCRUM-66: only an organiser may
    });
  });
});

// ---------------------------------------------------------------------------
// SCRUM-111/AC5, AC6, AC7 — the event shows its latest details, and whether this viewer may edit them
// ---------------------------------------------------------------------------
describe("SCRUM-111/AC5, AC6, AC7 — GET /events/:id after an edit (111-S15 to 111-S17)", () => {
  /** "Tech Summit", a Conference with a description and venue requirements, assigned to `coordinatorId`. */
  function withEvent(status: string) {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice Johnson");
    const coordinator = fake.signIn("event_coordinator");
    const other = fake.signIn("event_coordinator");
    const categoryId = crypto.randomUUID();
    fake.tables.event_categories.push({ id: categoryId, name: "Conference" });
    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status,
      description: "Annual summit",
      event_category_id: categoryId,
      venue_requirements: "Stage and lift",
      organiser_id: organiser.id,
      assigned_coordinator_id: coordinator.id,
    });
    const view = (who: { cookie: string }) => request(createApp(fake.deps)).get(`/events/${eventId}`).set("Cookie", who.cookie);
    return { view, organiser, coordinator, other };
  }

  // the edit form can save these, so the event page shows them too
  it("111-S15 returns the description, the category's name and the venue requirements", async () => {
    const { view, coordinator } = withEvent("planning");

    const res = await view(coordinator);

    expect(res.body).toMatchObject({ description: "Annual summit", category_name: "Conference", venue_requirements: "Stage and lift" });
  });

  it("111-S15 the organiser sees them too", async () => {
    const { view, organiser } = withEvent("planning");

    expect((await view(organiser)).body).toMatchObject({ description: "Annual summit", category_name: "Conference" });
  });

  // canEdit tells the page whether to offer "Edit event details"
  it.each(["submitted", "approved", "planning", "confirmed"])("111-S17 the assigned coordinator of a %s event may edit it", async (status) => {
    const { view, coordinator } = withEvent(status);

    expect((await view(coordinator)).body.canEdit).toBe(true);
  });

  it.each(["completed", "cancelled", "rejected"])("111-S16 a %s event can't be edited, even by its coordinator", async (status) => {
    const { view, coordinator } = withEvent(status);

    expect((await view(coordinator)).body.canEdit).toBe(false);
  });

  it("111-S17 another coordinator, and the organiser, may not edit it", async () => {
    const { view, other, organiser } = withEvent("planning");

    expect((await view(other)).body.canEdit).toBe(false);
    expect((await view(organiser)).body.canEdit).toBe(false);
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
      { id: crypto.randomUUID(), name: "Tech Summit", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Submitted Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Sep Event", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      { id: crypto.randomUUID(), name: "Tech Summit", status: "submitted", submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id, assigned_coordinator_id: coordinator.id },
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
      assigned_coordinator_id: coordinator.id,
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
      assigned_coordinator_id: coordinator.id,
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
      assigned_coordinator_id: coordinator.id,
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
// SCRUM-24/AC1, AC2 — Only requests awaiting a decision can be approved or rejected
// ---------------------------------------------------------------------------
describe("SCRUM-24/AC1, AC2 — Decision only on requests awaiting one", () => {
  const decide = (action: "approve" | "reject") => async (status: string) => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status, organiser_id: organiser.id, assigned_coordinator_id: coordinator.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps))
      .post(`/events/${event.id}/${action}`)
      .set("Cookie", coordinator.cookie)
      .send({ reason: "Venue not available." });
    return { res, event };
  };

  it.each(["approve", "reject"] as const)("lets a coordinator %s a request that is under review", async (action) => {
    const { res, event } = await decide(action)("under_review");

    expect(res.status).toBe(200);
    expect(event.status).toBe(action === "approve" ? "approved" : "rejected");
  });

  it.each([
    ["approve", "approved"],
    ["approve", "cancelled"],
    ["reject", "rejected"],
    ["reject", "draft"],
  ] as const)("refuses to %s a request that is %s, leaving it unchanged", async (action, status) => {
    const { res, event } = await decide(action)(status);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Only submitted or under-review requests can be approved or rejected." });
    expect(event.status).toBe(status);
  });

  it.each(["approve", "reject"] as const)("returns 404 when asked to %s an event that doesn't exist", async (action) => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");

    const res = await request(createApp(fake.deps))
      .post(`/events/${crypto.randomUUID()}/${action}`)
      .set("Cookie", coordinator.cookie)
      .send({ reason: "Venue not available." });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-24/AC5 — Only the assigned coordinator may approve or reject
// ---------------------------------------------------------------------------
describe("SCRUM-24/AC5 — Only the assigned coordinator decides", () => {
  const attempt = async (action: "approve" | "reject", assignTo: "someone else" | "nobody") => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const assigned = fake.signIn("event_coordinator");
    const otherCoordinator = fake.signIn("event_coordinator");
    const event = {
      id: crypto.randomUUID(),
      name: "Tech Summit",
      status: "submitted",
      organiser_id: organiser.id,
      assigned_coordinator_id: assignTo === "someone else" ? assigned.id : null,
    };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps))
      .post(`/events/${event.id}/${action}`)
      .set("Cookie", otherCoordinator.cookie)
      .send({ reason: "Venue not available." });
    return { res, event };
  };

  it.each([
    ["approve", "someone else"],
    ["reject", "someone else"],
    ["approve", "nobody"],
    ["reject", "nobody"],
  ] as const)("refuses a coordinator who tries to %s an event assigned to %s", async (action, assignTo) => {
    const { res, event } = await attempt(action, assignTo);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Only the coordinator assigned to this event can approve or reject it." });
    expect(event.status).toBe("submitted");
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
      comment_text: "Please provide more details.",
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
    expect(res.body.comments).toHaveLength(1);
    expect(res.body.comments[0]).toMatchObject({
      author_name: "Bob Lee",
      body: "Please provide more details.",
    });
    expect(res.body.comments[0].created_at).toBeDefined();
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
        comment_text: "Third comment",
        created_at: "2026-09-03T12:00:00.000Z",
      },
      {
        id: crypto.randomUUID(),
        event_id: eventId,
        author_id: coordinator.id,
        comment_text: "First comment",
        created_at: "2026-09-01T12:00:00.000Z",
      },
      {
        id: crypto.randomUUID(),
        event_id: eventId,
        author_id: coordinator.id,
        comment_text: "Second comment",
        created_at: "2026-09-02T12:00:00.000Z",
      },
    ];

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body.comments).toHaveLength(3);
    expect(res.body.comments[0].body).toBe("First comment");
    expect(res.body.comments[1].body).toBe("Second comment");
    expect(res.body.comments[2].body).toBe("Third comment");
  });
});

describe("SCRUM-25/AC5 — Comment permissions", () => {
  it("includes can_comment: true for an event_coordinator", async () => {
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
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);
    expect(res.status).toBe(200);
    expect(res.body.can_comment).toBe(true);
    expect(Array.isArray(res.body.comments)).toBe(true);
  });

  it("includes can_comment: true for an event_organiser", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice Tan");
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
      .set("Cookie", organiser.cookie);
    expect(res.status).toBe(200);
    expect(res.body.can_comment).toBe(true);
    expect(Array.isArray(res.body.comments)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-26/AC1 — Reply to a comment
// ---------------------------------------------------------------------------
describe("SCRUM-26/AC1 — Reply to a comment", () => {
  it("saves a reply associated with the parent comment and returns 201", async () => {
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

    const parentCommentId = crypto.randomUUID();
    fake.tables.event_comments.push({
      id: parentCommentId,
      event_id: eventId,
      author_id: organiser.id,
      comment_text: "Please clarify the venue requirements.",
      created_at: "2026-09-02T10:00:00.000Z",
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: "We can accommodate that.", parent_comment_id: parentCommentId });

    expect(res.status).toBe(201);
    const reply = fake.tables.event_comments.find((c) => c.parent_comment_id === parentCommentId);
    expect(reply).toBeDefined();
    expect(reply?.comment_text).toBe("We can accommodate that.");
    expect(reply?.parent_comment_id).toBe(parentCommentId);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-26/AC2 — Display reply details and visual hierarchy
// ---------------------------------------------------------------------------
describe("SCRUM-26/AC2 — Display reply details and visual hierarchy", () => {
  it("includes parent_comment_id on replies returned by GET /comments", async () => {
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

    const parentId = crypto.randomUUID();
    const replyId = crypto.randomUUID();
    fake.tables.event_comments.push(
      {
        id: parentId,
        event_id: eventId,
        author_id: organiser.id,
        comment_text: "Please clarify the venue requirements.",
        created_at: "2026-09-02T10:00:00.000Z",
      },
      {
        id: replyId,
        event_id: eventId,
        author_id: coordinator.id,
        comment_text: "We can accommodate that.",
        created_at: "2026-09-02T11:00:00.000Z",
        parent_comment_id: parentId,
      },
    );

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    const reply = (res.body.comments as { id: string; parent_comment_id?: string }[]).find(
      (c) => c.id === replyId,
    );
    expect(reply).toBeDefined();
    expect(reply?.parent_comment_id).toBe(parentId);
    const parent = (res.body.comments as { id: string; parent_comment_id?: string | null }[]).find(
      (c) => c.id === parentId,
    );
    expect(parent).toBeDefined();
    expect(parent?.parent_comment_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SCRUM-26/AC3 — Order replies (oldest to newest within a thread)
// ---------------------------------------------------------------------------
describe("SCRUM-26/AC3 — Order replies oldest to newest", () => {
  it("returns replies in ascending created_at order within a thread", async () => {
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

    const parentId = crypto.randomUUID();
    const reply1Id = crypto.randomUUID();
    const reply2Id = crypto.randomUUID();
    const reply3Id = crypto.randomUUID();
    // Insert replies out of chronological order to confirm sorting is applied
    fake.tables.event_comments.push(
      {
        id: parentId,
        event_id: eventId,
        author_id: organiser.id,
        comment_text: "What are the venue requirements?",
        created_at: "2026-09-02T09:00:00.000Z",
      },
      {
        id: reply3Id,
        event_id: eventId,
        author_id: coordinator.id,
        comment_text: "Third reply.",
        created_at: "2026-09-02T13:00:00.000Z",
        parent_comment_id: parentId,
      },
      {
        id: reply1Id,
        event_id: eventId,
        author_id: coordinator.id,
        comment_text: "First reply.",
        created_at: "2026-09-02T11:00:00.000Z",
        parent_comment_id: parentId,
      },
      {
        id: reply2Id,
        event_id: eventId,
        author_id: organiser.id,
        comment_text: "Second reply.",
        created_at: "2026-09-02T12:00:00.000Z",
        parent_comment_id: parentId,
      },
    );

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    const comments = res.body.comments as { id: string; parent_comment_id?: string | null }[];
    const replies = comments.filter((c) => c.parent_comment_id === parentId);
    expect(replies).toHaveLength(3);
    expect(replies[0].id).toBe(reply1Id);
    expect(replies[1].id).toBe(reply2Id);
    expect(replies[2].id).toBe(reply3Id);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-26/AC4 — Prevent empty replies
// ---------------------------------------------------------------------------
describe("SCRUM-26/AC4 — Prevent empty replies", () => {
  it("returns 400 when reply body is empty string", async () => {
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

    const parentId = crypto.randomUUID();
    fake.tables.event_comments.push({
      id: parentId,
      event_id: eventId,
      author_id: organiser.id,
      comment_text: "What are the venue requirements?",
      created_at: "2026-09-02T09:00:00.000Z",
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: "", parent_comment_id: parentId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 when reply body is whitespace only", async () => {
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

    const parentId = crypto.randomUUID();
    fake.tables.event_comments.push({
      id: parentId,
      event_id: eventId,
      author_id: organiser.id,
      comment_text: "What are the venue requirements?",
      created_at: "2026-09-02T09:00:00.000Z",
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: "   ", parent_comment_id: parentId });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SCRUM-27/AC1 — Search for users
// ---------------------------------------------------------------------------
describe("SCRUM-27/AC1 — Search for users", () => {
  it("returns matching eligible users (coordinators and organisers) by partial name", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice Johnson");
    const coordinator = fake.signIn("event_coordinator", "Bob Lee");
    const coordinator2 = fake.signIn("event_coordinator", "Alice Smith");
    // attendee with matching name — must NOT appear
    fake.signIn("attendee", "Alice Attendee");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/mentionable-users?query=alice`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    const names = (res.body as { id: string; full_name: string }[]).map((u) => u.full_name);
    expect(names).toContain("Alice Johnson");
    expect(names).toContain("Alice Smith");
    expect(names).not.toContain("Alice Attendee");
  });

  it("returns empty array when no eligible user matches the query", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Bob Smith");
    const coordinator = fake.signIn("event_coordinator", "Carol White");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId,
      name: "Tech Summit",
      status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/mentionable-users?query=xyz`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 403 when caller does not have access to the request", async () => {
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
      .get(`/events/${eventId}/mentionable-users?query=alice`)
      .set("Cookie", attendee.cookie);

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
      submitted_at: "2026-09-01T10:00:00.000Z",
      organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/mentionable-users?query=alice`);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-27/AC5 — Restrict mentions
// ---------------------------------------------------------------------------
describe("SCRUM-27/AC5 — Restrict mentions", () => {
  const setup = () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Olivia Org");
    const otherOrganiser = fake.signIn("event_organiser", "Oscar Other");
    const coordinator = fake.signIn("event_coordinator", "Carl Coord");
    const coordinator2 = fake.signIn("event_coordinator", "Cora Coord");
    fake.signIn("venue_staff", "Vera Venue");
    const eventId = crypto.randomUUID();
    fake.tables.events.push({ id: eventId, name: "Tech Summit", status: "submitted", organiser_id: organiser.id });
    const search = (cookie: string, query = "") =>
      request(createApp(fake.deps)).get(`/events/${eventId}/mentionable-users?query=${query}`).set("Cookie", cookie);
    return { fake, organiser, otherOrganiser, coordinator, coordinator2, eventId, search };
  };
  const names = (body: unknown) => (body as { full_name: string }[]).map((u) => u.full_name).sort();

  it("offers the coordinators and this event's organiser, not another event's organiser or other roles", async () => {
    const { coordinator, search } = setup();

    const res = await search(coordinator.cookie);

    expect(res.status).toBe(200);
    expect(names(res.body)).toEqual(["Cora Coord", "Olivia Org"]);
  });

  it("doesn't offer the caller to themselves", async () => {
    const { organiser, search } = setup();

    const res = await search(organiser.cookie);

    expect(names(res.body)).toEqual(["Carl Coord", "Cora Coord"]);
  });

  it("refuses an organiser searching on someone else's event", async () => {
    const { otherOrganiser, search } = setup();

    const res = await search(otherOrganiser.cookie);

    expect(res.status).toBe(403);
  });

  it("returns 404 for an event that doesn't exist", async () => {
    const { fake, coordinator } = setup();

    const res = await request(createApp(fake.deps))
      .get(`/events/${crypto.randomUUID()}/mentionable-users`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-27/AC2 — Add a mention
// ---------------------------------------------------------------------------
describe("SCRUM-27/AC2 — Add a mention", () => {
  it("saves a mention record when the comment body contains a @[userId] marker", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: `Hello @[${organiser.id}] please review this.` });

    expect(res.status).toBe(201);
    const mentions = fake.tables.event_comment_mentions ?? [];
    expect(mentions).toHaveLength(1);
    expect(mentions[0].user_id).toBe(organiser.id);
  });

  it("saves multiple mention records for multiple @[userId] markers in the body", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");
    const coordinator2 = fake.signIn("event_coordinator", "Carol");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: `@[${organiser.id}] and @[${coordinator2.id}] please check.` });

    expect(res.status).toBe(201);
    const mentions = fake.tables.event_comment_mentions ?? [];
    expect(mentions).toHaveLength(2);
    const mentionedIds = mentions.map((m: Row) => m.user_id);
    expect(mentionedIds).toContain(organiser.id);
    expect(mentionedIds).toContain(coordinator2.id);
  });

  it("saves no mention records when the comment body contains no @[userId] markers", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: "Just a plain comment with no mentions." });

    expect(res.status).toBe(201);
    const mentions = fake.tables.event_comment_mentions ?? [];
    expect(mentions).toHaveLength(0);
  });

  it("returns 403 and saves no mentions when caller is not authorised", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const attendee = fake.signIn("attendee");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", attendee.cookie)
      .send({ body: `Hello @[${organiser.id}].` });

    expect(res.status).toBe(403);
    const mentions = fake.tables.event_comment_mentions ?? [];
    expect(mentions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-27/AC3 — Display mentions
// ---------------------------------------------------------------------------
describe("SCRUM-47/AC9 — a comment and its mentions are saved together", () => {
  it("posts the comment through one post_event_comment call with its mentions", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");
    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: `Hello @[${organiser.id}] please review this.` });

    expect(res.status).toBe(201);
    expect(fake.rpcCalls).toEqual([
      {
        fn: "post_event_comment",
        args: {
          p_event_id: eventId,
          p_body: `Hello @[${organiser.id}] please review this.`,
          p_parent_comment_id: null,
          p_mentions: [organiser.id],
          p_clarification_request: false,
        },
      },
    ]);
  });

  it("SCRUM-47/AC2 asks the database to mark the comment as a clarification request when the coordinator ticks it", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");
    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted", assigned_coordinator_id: coordinator.id,
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: "How many guests use wheelchairs?", clarification_request: true });

    expect(res.status).toBe(201);
    expect(fake.rpcCalls[0].args.p_clarification_request).toBe(true);
  });

  it("SCRUM-47/AC2 lists which comments are clarification requests, so the organiser knows what to answer", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");
    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted", assigned_coordinator_id: coordinator.id,
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });
    const app = createApp(fake.deps);
    await request(app).post(`/events/${eventId}/comments`).set("Cookie", coordinator.cookie)
      .send({ body: "How many guests use wheelchairs?", clarification_request: true });
    await request(app).post(`/events/${eventId}/comments`).set("Cookie", coordinator.cookie)
      .send({ body: "Thanks for submitting." });

    const res = await request(app).get(`/events/${eventId}/comments`).set("Cookie", organiser.cookie);

    expect(res.body.comments.map((c: Row) => [c.body, c.is_clarification_request])).toEqual([
      ["How many guests use wheelchairs?", true],
      ["Thanks for submitting.", false],
    ]);
  });

  it("SCRUM-47/AC2 only the event's assigned coordinator is offered the clarification request", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const assigned = fake.signIn("event_coordinator", "Bob");
    const other = fake.signIn("event_coordinator", "Carol");
    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted", assigned_coordinator_id: assigned.id,
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });
    const app = createApp(fake.deps);
    const offered = async (cookie: string) =>
      (await request(app).get(`/events/${eventId}/comments`).set("Cookie", cookie)).body.can_request_clarification;

    expect([await offered(assigned.cookie), await offered(other.cookie), await offered(organiser.cookie)]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("SCRUM-47/AC10 a comment the database refuses is reported as refused, and no attachment is saved", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");
    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({
        body: "@[refused-venue-staff] can you check the hall?",
        attachments: [{ file_name: "plan.pdf", storage_path: `${eventId}/plan.pdf` }],
      });

    expect(res.status).toBe(403);
    expect(fake.tables.event_comment_attachments).toEqual([]);
  });
});

describe("SCRUM-27/AC3 — Display mentions", () => {
  it("includes a mentions array with user_id and full_name for a mentioned user", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const commentId = crypto.randomUUID();
    fake.tables.event_comments.push({
      id: commentId, event_id: eventId, author_id: coordinator.id,
      body: `Hello @[${organiser.id}] please review this.`,
      created_at: "2026-09-01T11:00:00.000Z", parent_comment_id: null,
    });
    fake.tables.event_comment_mentions.push({ comment_id: commentId, user_id: organiser.id });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    const [comment] = res.body.comments;
    expect(comment.mentions).toHaveLength(1);
    expect(comment.mentions[0].user_id).toBe(organiser.id);
    expect(comment.mentions[0].full_name).toBe("Alice");
  });

  it("includes all mentioned users when a comment has multiple mentions", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");
    const coordinator2 = fake.signIn("event_coordinator", "Carol");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const commentId = crypto.randomUUID();
    fake.tables.event_comments.push({
      id: commentId, event_id: eventId, author_id: coordinator.id,
      body: `@[${organiser.id}] and @[${coordinator2.id}] please check.`,
      created_at: "2026-09-01T11:00:00.000Z", parent_comment_id: null,
    });
    fake.tables.event_comment_mentions.push({ comment_id: commentId, user_id: organiser.id });
    fake.tables.event_comment_mentions.push({ comment_id: commentId, user_id: coordinator2.id });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    const [comment] = res.body.comments;
    expect(comment.mentions).toHaveLength(2);
    const ids = comment.mentions.map((m: Row) => m.user_id);
    expect(ids).toContain(organiser.id);
    expect(ids).toContain(coordinator2.id);
  });

  it("returns mentions: [] for a comment with no mentions", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const commentId = crypto.randomUUID();
    fake.tables.event_comments.push({
      id: commentId, event_id: eventId, author_id: coordinator.id,
      comment_text: "Just a plain comment.",
      created_at: "2026-09-01T11:00:00.000Z", parent_comment_id: null,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body.comments[0].mentions).toEqual([]);
  });

  it("does not include mentions from a different comment on the same event", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const commentId1 = crypto.randomUUID();
    const commentId2 = crypto.randomUUID();
    fake.tables.event_comments.push({
      id: commentId1, event_id: eventId, author_id: coordinator.id,
      body: `Hello @[${organiser.id}].`,
      created_at: "2026-09-01T11:00:00.000Z", parent_comment_id: null,
    });
    fake.tables.event_comments.push({
      id: commentId2, event_id: eventId, author_id: organiser.id,
      comment_text: "No mentions here.",
      created_at: "2026-09-01T12:00:00.000Z", parent_comment_id: null,
    });
    fake.tables.event_comment_mentions.push({ comment_id: commentId1, user_id: organiser.id });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    const comments = res.body.comments;
    expect(comments[0].mentions).toHaveLength(1);
    expect(comments[1].mentions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-28/AC1 — Attach multiple files
// ---------------------------------------------------------------------------
describe("SCRUM-28/AC1 — Attach multiple files", () => {
  it("persists a single attachment record when one file is provided with the comment", async () => {
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
      .send({
        body: "Please review the attached document.",
        attachments: [{ file_name: "proposal.pdf", storage_path: "attachments/proposal.pdf" }],
      });

    expect(res.status).toBe(201);
    expect(fake.tables.event_comment_attachments).toHaveLength(1);
    expect(fake.tables.event_comment_attachments[0]).toMatchObject({
      file_name: "proposal.pdf",
      storage_path: "attachments/proposal.pdf",
    });
  });

  it("persists multiple attachment records when several files are provided with the comment", async () => {
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
      .send({
        body: "See attached files.",
        attachments: [
          { file_name: "agenda.pdf", storage_path: "attachments/agenda.pdf" },
          { file_name: "budget.xlsx", storage_path: "attachments/budget.xlsx" },
          { file_name: "floor-plan.png", storage_path: "attachments/floor-plan.png" },
        ],
      });

    expect(res.status).toBe(201);
    expect(fake.tables.event_comment_attachments).toHaveLength(3);
    const fileNames = fake.tables.event_comment_attachments.map((a) => a.file_name);
    expect(fileNames).toContain("agenda.pdf");
    expect(fileNames).toContain("budget.xlsx");
    expect(fileNames).toContain("floor-plan.png");
  });

  it("persists no attachment records when no attachments are provided", async () => {
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
      .send({ body: "Plain comment, no files." });

    expect(res.status).toBe(201);
    expect(fake.tables.event_comment_attachments).toHaveLength(0);
  });

  it("associates each attachment with the correct comment id", async () => {
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

    await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({ body: "First comment, no files." });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({
        body: "Second comment with attachment.",
        attachments: [{ file_name: "doc.pdf", storage_path: "attachments/doc.pdf" }],
      });

    expect(res.status).toBe(201);
    expect(fake.tables.event_comment_attachments).toHaveLength(1);
    const secondComment = fake.tables.event_comments.find((c) => c.comment_text === "Second comment with attachment.");
    expect(fake.tables.event_comment_attachments[0].comment_id).toBe(secondComment?.id);
  });

  it("persists attachments on a reply (comment with parent_comment_id)", async () => {
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

    const parentId = crypto.randomUUID();
    fake.tables.event_comments.push({
      id: parentId,
      event_id: eventId,
      author_id: organiser.id,
      comment_text: "Please provide the floor plan.",
      created_at: "2026-09-02T10:00:00.000Z",
    });

    const res = await request(createApp(fake.deps))
      .post(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie)
      .send({
        body: "Here is the floor plan.",
        parent_comment_id: parentId,
        attachments: [{ file_name: "floor-plan.pdf", storage_path: "attachments/floor-plan.pdf" }],
      });

    expect(res.status).toBe(201);
    expect(fake.tables.event_comment_attachments).toHaveLength(1);
    expect(fake.tables.event_comment_attachments[0]).toMatchObject({
      file_name: "floor-plan.pdf",
      storage_path: "attachments/floor-plan.pdf",
    });
  });
});

// ---------------------------------------------------------------------------
// SCRUM-28/AC1, AC4–AC6 — Upload URL for a staged file
// ---------------------------------------------------------------------------
describe("SCRUM-28/AC1, AC4-AC6 — Upload URL for a staged file", () => {
  const setup = (eventId: string = crypto.randomUUID()) => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const otherOrganiser = fake.signIn("event_organiser");
    const coordinator = fake.signIn("event_coordinator");
    const venueStaff = fake.signIn("venue_staff");
    fake.tables.events.push({ id: eventId, name: "Tech Summit", status: "submitted", organiser_id: organiser.id });
    const ask = (cookie: string, body: object, id = eventId) =>
      request(createApp(fake.deps)).post(`/events/${id}/attachments/upload-url`).set("Cookie", cookie).send(body);
    return { eventId, organiser, otherOrganiser, coordinator, venueStaff, ask };
  };
  const pdf = { file_name: "floor plan (v2).pdf", content_type: "application/pdf", size: 2048 };

  it("AC1, AC4: gives a coordinator an upload URL under the event's own folder", async () => {
    const { eventId, coordinator, ask } = setup();

    const res = await ask(coordinator.cookie, pdf);

    expect(res.status).toBe(200);
    expect(res.body.storage_path).toMatch(new RegExp(`^${eventId}/[0-9a-f-]{36}/floor_plan_v2_.pdf$`));
    expect(res.body.upload_url).toBe(`https://fake-storage/upload/${res.body.storage_path}?token=up`);
  });

  it("AC1: gives the event's organiser an upload URL, and two files with one name different paths", async () => {
    const { organiser, ask } = setup();

    const first = await ask(organiser.cookie, pdf);
    const second = await ask(organiser.cookie, pdf);

    expect(first.status).toBe(200);
    expect(first.body.storage_path).not.toBe(second.body.storage_path);
  });

  it("AC5: refuses an unsupported file type", async () => {
    const { coordinator, ask } = setup();

    const res = await ask(coordinator.cookie, { ...pdf, file_name: "setup.exe", content_type: "application/x-msdownload" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This file type is not supported. Attach an image, video or document.");
  });

  it("AC6: refuses a file over 10 MB", async () => {
    const { coordinator, ask } = setup();

    const res = await ask(coordinator.cookie, { ...pdf, size: 10 * 1024 * 1024 + 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This file is larger than the 10 MB limit.");
  });

  it.each([
    ["no file name", { ...pdf, file_name: "  " }],
    ["no size", { file_name: "a.pdf", content_type: "application/pdf" }],
    ["a negative size", { ...pdf, size: -1 }],
  ])("returns 400 for %s", async (_label, body) => {
    const { coordinator, ask } = setup();

    const res = await ask(coordinator.cookie, body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("file_name, content_type and size are required.");
  });

  it("treats a missing content type as unsupported", async () => {
    const { coordinator, ask } = setup();

    const res = await ask(coordinator.cookie, { file_name: "a.pdf", size: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This file type is not supported. Attach an image, video or document.");
  });

  it("returns 403 to roles that can't see the conversation, and to another event's organiser", async () => {
    const { venueStaff, otherOrganiser, ask } = setup();

    expect((await ask(venueStaff.cookie, pdf)).status).toBe(403);
    expect((await ask(otherOrganiser.cookie, pdf)).status).toBe(403);
  });

  it("returns 404 for an event that doesn't exist", async () => {
    const { coordinator, ask } = setup();

    expect((await ask(coordinator.cookie, pdf, crypto.randomUUID())).status).toBe(404);
  });

  it("returns 500 when storage won't issue the URL", async () => {
    const { coordinator, ask } = setup("refused");

    const res = await ask(coordinator.cookie, pdf);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Could not prepare the upload. Please try again.");
  });

  it("returns 401 when not signed in", async () => {
    const { eventId } = setup();

    const res = await request(createApp(createFake().deps)).post(`/events/${eventId}/attachments/upload-url`).send(pdf);

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-28/AC5 — Display attachments
// ---------------------------------------------------------------------------
describe("SCRUM-28/AC5 — Display attachments", () => {
  it("includes an attachments array with file_name and storage_path for a comment with one attachment", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const commentId = crypto.randomUUID();
    fake.tables.event_comments.push({
      id: commentId, event_id: eventId, author_id: coordinator.id,
      comment_text: "Please review the attached document.",
      created_at: "2026-09-01T11:00:00.000Z", parent_comment_id: null,
    });
    fake.tables.event_comment_attachments.push({
      comment_id: commentId, file_name: "proposal.pdf", storage_path: "attachments/proposal.pdf",
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    const [comment] = res.body.comments;
    expect(comment.attachments).toHaveLength(1);
    expect(comment.attachments[0].file_name).toBe("proposal.pdf");
    expect(comment.attachments[0].storage_path).toBe("attachments/proposal.pdf");
  });

  it("includes all attachments when a comment has multiple files", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const commentId = crypto.randomUUID();
    fake.tables.event_comments.push({
      id: commentId, event_id: eventId, author_id: coordinator.id,
      comment_text: "See attached files.",
      created_at: "2026-09-01T11:00:00.000Z", parent_comment_id: null,
    });
    fake.tables.event_comment_attachments.push(
      { comment_id: commentId, file_name: "agenda.pdf", storage_path: "attachments/agenda.pdf" },
      { comment_id: commentId, file_name: "budget.xlsx", storage_path: "attachments/budget.xlsx" },
    );

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    const [comment] = res.body.comments;
    expect(comment.attachments).toHaveLength(2);
    const names = comment.attachments.map((a: Row) => a.file_name);
    expect(names).toContain("agenda.pdf");
    expect(names).toContain("budget.xlsx");
  });

  it("returns attachments: [] for a comment with no attachments", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const commentId = crypto.randomUUID();
    fake.tables.event_comments.push({
      id: commentId, event_id: eventId, author_id: coordinator.id,
      comment_text: "Just a plain comment.",
      created_at: "2026-09-01T11:00:00.000Z", parent_comment_id: null,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body.comments[0].attachments).toEqual([]);
  });

  it("does not include attachments from a different comment on the same event", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");

    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const commentId1 = crypto.randomUUID();
    const commentId2 = crypto.randomUUID();
    fake.tables.event_comments.push(
      {
        id: commentId1, event_id: eventId, author_id: coordinator.id,
        comment_text: "First comment with attachment.",
        created_at: "2026-09-01T11:00:00.000Z", parent_comment_id: null,
      },
      {
        id: commentId2, event_id: eventId, author_id: organiser.id,
        comment_text: "Second comment, no attachment.",
        created_at: "2026-09-01T12:00:00.000Z", parent_comment_id: null,
      },
    );
    fake.tables.event_comment_attachments.push({
      comment_id: commentId1, file_name: "doc.pdf", storage_path: "attachments/doc.pdf",
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/comments`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    const comments = res.body.comments;
    expect(comments[0].attachments).toHaveLength(1);
    expect(comments[1].attachments).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SCRUM-28/AC6 — Access attachments
// ---------------------------------------------------------------------------
describe("SCRUM-28/AC6 — Access attachments", () => {
  it("returns a signed URL for a coordinator requesting a stored attachment", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");
    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/attachments/signed-url?storage_path=attachments/proposal.pdf`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.signed_url).toBe("string");
    expect(res.body.signed_url.length).toBeGreaterThan(0);
  });

  it("returns a signed URL for an organiser who owns the event", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/attachments/signed-url?storage_path=attachments/plan.pdf`)
      .set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(typeof res.body.signed_url).toBe("string");
  });

  it("returns 403 when the caller role cannot access event attachments", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });
    const stranger = fake.signIn("attendee");

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/attachments/signed-url?storage_path=attachments/proposal.pdf`)
      .set("Cookie", stranger.cookie);

    expect(res.status).toBe(403);
  });

  it("returns 400 when storage_path query param is missing", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice");
    const coordinator = fake.signIn("event_coordinator", "Bob");
    const eventId = crypto.randomUUID();
    fake.tables.events.push({
      id: eventId, name: "Tech Summit", status: "submitted",
      submitted_at: "2026-09-01T10:00:00.000Z", organiser_id: organiser.id,
    });

    const res = await request(createApp(fake.deps))
      .get(`/events/${eventId}/attachments/signed-url`)
      .set("Cookie", coordinator.cookie);

    expect(res.status).toBe(400);
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

// ---------------------------------------------------------------------------
// SCRUM-44 — Organiser views the review outcome
// ---------------------------------------------------------------------------
describe("SCRUM-44 — View event request review outcome", () => {
  /** An event by Adrian (organiser) in the given status, with Rachel (coordinator) as the decider in its history. */
  const setup = (status: string, history: (coordinatorId: string) => Row[] = () => []) => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Adrian Foo");
    const coordinator = fake.signIn("event_coordinator", "Rachel Tan");
    const eventId = crypto.randomUUID();
    fake.tables.events.push({ id: eventId, name: "Investor Briefing", status, organiser_id: organiser.id });
    fake.tables.event_status_history = history(coordinator.id).map((h) => ({ event_id: eventId, ...h }));
    const outcome = (cookie: string, id = eventId) =>
      request(createApp(fake.deps)).get(`/events/${id}/outcome`).set("Cookie", cookie);
    return { fake, organiser, coordinator, eventId, outcome };
  };

  it("AC1, AC4: shows an approval, when it was made and who made it", async () => {
    const { organiser, outcome } = setup("approved", (c) => [
      { old_status: "submitted", new_status: "under_review", changed_by: c, reason: null, changed_at: "2026-09-01T02:00:00Z" },
      { old_status: "under_review", new_status: "approved", changed_by: c, reason: null, changed_at: "2026-09-02T03:00:00Z" },
    ]);

    const res = await outcome(organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      decision: { outcome: "approved", decided_at: "2026-09-02T03:00:00Z", reason: null, decided_by_name: "Rachel Tan" },
    });
  });

  it("AC2, AC3: shows a rejection with the coordinator's reason", async () => {
    const { organiser, outcome } = setup("rejected", (c) => [
      { old_status: "submitted", new_status: "rejected", changed_by: c, reason: "Venue too small.", changed_at: "2026-09-02T03:00:00Z" },
    ]);

    const res = await outcome(organiser.cookie);

    expect(res.body.decision).toMatchObject({ outcome: "rejected", reason: "Venue too small." });
  });

  it("AC4: keeps showing the approval after the event moves on to planning", async () => {
    const { organiser, outcome } = setup("planning", (c) => [
      { old_status: "under_review", new_status: "approved", changed_by: c, reason: null, changed_at: "2026-09-02T03:00:00Z" },
      { old_status: "approved", new_status: "planning", changed_by: c, reason: null, changed_at: "2026-09-05T03:00:00Z" },
    ]);

    expect((await outcome(organiser.cookie)).body.decision).toMatchObject({ outcome: "approved" });
  });

  it("AC4: shows the most recent decision when there were several", async () => {
    const { organiser, outcome } = setup("approved", (c) => [
      { old_status: "under_review", new_status: "rejected", changed_by: c, reason: "First try.", changed_at: "2026-09-01T03:00:00Z" },
      { old_status: "under_review", new_status: "approved", changed_by: c, reason: null, changed_at: "2026-09-09T03:00:00Z" },
    ]);

    expect((await outcome(organiser.cookie)).body.decision).toMatchObject({ outcome: "approved", decided_at: "2026-09-09T03:00:00Z" });
  });

  it.each(["draft", "submitted", "under_review", "returned"])(
    "AC5: shows no decision while the request is %s, even if an older one exists",
    async (status) => {
      const { organiser, outcome } = setup(status, (c) => [
        { old_status: "under_review", new_status: "rejected", changed_by: c, reason: "Old.", changed_at: "2026-09-01T03:00:00Z" },
      ]);

      const res = await outcome(organiser.cookie);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ decision: null });
    },
  );

  it("AC5: shows no decision for an event cancelled before anyone decided", async () => {
    const { organiser, outcome } = setup("cancelled");

    expect((await outcome(organiser.cookie)).body).toEqual({ decision: null });
  });

  it("AC6: lets a coordinator see the outcome too", async () => {
    const { coordinator, outcome } = setup("approved", (c) => [
      { old_status: "under_review", new_status: "approved", changed_by: c, reason: null, changed_at: "2026-09-02T03:00:00Z" },
    ]);

    expect((await outcome(coordinator.cookie)).status).toBe(200);
  });

  it("AC6: hides another organiser's event as if it didn't exist", async () => {
    const { fake, outcome } = setup("approved");
    const stranger = fake.signIn("event_organiser", "Someone Else");

    const res = await outcome(stranger.cookie);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Event not found." });
  });

  it.each(["attendee", "venue_staff", "technical_support_staff"])("AC6: refuses a %s", async (role) => {
    const { fake, outcome } = setup("approved");
    const other = fake.signIn(role);

    expect((await outcome(other.cookie)).status).toBe(403);
  });

  it("returns 404 for an event that doesn't exist", async () => {
    const { coordinator, outcome } = setup("approved");

    expect((await outcome(coordinator.cookie, crypto.randomUUID())).status).toBe(404);
  });

  it("returns 401 when not signed in", async () => {
    const { eventId } = setup("approved");
    const fake = createFake();

    expect((await request(createApp(fake.deps)).get(`/events/${eventId}/outcome`)).status).toBe(401);
  });
});

describe("SCRUM-127/AC2 — Where a rejected or cancelled event stopped", () => {
  const stopped = async (status: string, history: Array<{ old_status: string; new_status: string; changed_at: string }>) => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser", "Alice Johnson");
    const eventId = crypto.randomUUID();
    fake.tables.events.push({ id: eventId, name: "Tech Summit", status, organiser_id: organiser.id });
    fake.tables.event_status_history.push(...history.map((h) => ({ event_id: eventId, ...h })));
    return request(createApp(fake.deps)).get(`/events/${eventId}`).set("Cookie", organiser.cookie);
  };

  it("returns the status a cancelled event had before it was cancelled", async () => {
    const res = await stopped("cancelled", [
      { old_status: "planning", new_status: "cancelled", changed_at: "2026-10-02T00:00:00Z" },
      { old_status: "approved", new_status: "planning", changed_at: "2026-10-01T00:00:00Z" },
    ]);
    expect(res.body.previous_status).toBe("planning");
  });

  it("uses the latest rejection when there is more than one", async () => {
    const res = await stopped("rejected", [
      { old_status: "under_review", new_status: "rejected", changed_at: "2026-10-03T00:00:00Z" },
      { old_status: "submitted", new_status: "rejected", changed_at: "2026-10-01T00:00:00Z" },
    ]);
    expect(res.body.previous_status).toBe("under_review");
  });

  it("is null for an event that was not stopped, or has no history", async () => {
    expect((await stopped("planning", [])).body.previous_status).toBeNull();
    expect((await stopped("cancelled", [])).body.previous_status).toBeNull();
  });
});
