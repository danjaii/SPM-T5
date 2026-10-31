import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// SCRUM-53/AC3: the organiser sees when a draft was last saved, so the event page and My event requests have to be sent
// the time (events.updated_at, kept current by trg_events_updated_at). POST /events/drafts already returns it (event-draft-create.test.ts).

type Row = Record<string, unknown>;

const ORGANISER = "cs_session=token-organiser";
const USERS: Row[] = [{ id: "organiser-1", role: "event_organiser", full_name: "Jason Chua" }];
const SAVED_AT = "2031-03-04T05:06:07.000Z";

const draft = (over: Row = {}): Row => ({
  id: "evt-1",
  name: "SMUX Council Meeting",
  status: "draft",
  organiser_id: "organiser-1",
  purpose: null,
  preferred_start_datetime: null,
  preferred_end_datetime: null,
  expected_attendance: null,
  preferred_room_layout: null,
  accessibility_requirements: null,
  equipment_requirements_notes: null,
  submitted_at: null,
  assigned_coordinator_id: null,
  organiser: { full_name: "Jason Chua" },
  description: "Meeting of the 6 SMUX Clubs",
  venue_requirements: null,
  category: null,
  created_at: "2031-03-01T00:00:00.000Z",
  updated_at: SAVED_AT,
  ...over,
});

/** Pretends to be Supabase: remembers the columns each events read asked for and returns only those, like the real thing. */
function createFake(events: Row[]) {
  const seen: { columns?: string } = {};
  const query = (table: string, rows: Row[], columns: string) => {
    const project = (list: Row[]) =>
      table === "events" ? list.map((row) => Object.fromEntries(columns.split(",").map((c) => c.trim()).filter((c) => !c.includes(":") && !c.includes("(")).map((c) => [c, row[c]]).concat(Object.entries(row).filter(([k]) => ["preferred_room_layout", "organiser", "category"].includes(k))))) : list;
    const builder = (current: Row[]): unknown => ({
      eq: (column: string, value: unknown) => builder(current.filter((row) => row[column] === value)),
      order: () => builder(current),
      limit: () => builder(current),
      maybeSingle: async () => ({ data: project(current)[0] ?? null, error: null }),
      then: (resolve: (result: unknown) => void) => resolve({ data: project(current), error: null }),
    });
    return builder(rows);
  };
  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) =>
          token === "token-organiser" ? { data: { user: { id: "organiser-1" } }, error: null } : { data: { user: null }, error: { message: "bad" } },
      },
    },
    forUser: () => ({
      from: (table: string) => ({
        select: (columns: string) => {
          if (table === "events") seen.columns = columns;
          return query(table, table === "users" ? USERS : table === "events" ? events : [], columns);
        },
      }),
    }),
  } as unknown as SupabaseDeps;
  return { deps, seen };
}

describe("SCRUM-53/AC3 the event page is sent when the draft was last saved (GET /events/:id)", () => {
  it("returns updated_at for the organiser's draft, matching the stored row", async () => {
    const fake = createFake([draft()]);

    const res = await request(createApp(fake.deps)).get("/events/evt-1").set("Cookie", ORGANISER);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "draft", submitted_at: null, updated_at: SAVED_AT });
  });

  it("asks the database for updated_at, so the time comes from the row and not the clock", async () => {
    const fake = createFake([draft({ updated_at: "2031-03-09T10:11:12.000Z" })]);

    const res = await request(createApp(fake.deps)).get("/events/evt-1").set("Cookie", ORGANISER);

    expect(fake.seen.columns).toMatch(/\bupdated_at\b/);
    expect(res.body.updated_at).toBe("2031-03-09T10:11:12.000Z");
  });
});

describe("SCRUM-53/AC3 My event requests is sent when each draft was last saved (GET /events/my-requests)", () => {
  it("returns updated_at for a draft row, matching the stored row", async () => {
    const fake = createFake([draft()]);

    const res = await request(createApp(fake.deps)).get("/events/my-requests").set("Cookie", ORGANISER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: "evt-1", status: "draft", submitted_at: null, updated_at: SAVED_AT });
  });

  it("returns each draft's own time, not one shared value", async () => {
    const fake = createFake([
      draft({ id: "a", updated_at: "2031-03-04T05:06:07.000Z", created_at: "2031-03-01T00:00:00.000Z" }),
      draft({ id: "b", updated_at: "2031-03-08T09:10:11.000Z", created_at: "2031-03-02T00:00:00.000Z" }),
    ]);

    const res = await request(createApp(fake.deps)).get("/events/my-requests").set("Cookie", ORGANISER);

    expect(Object.fromEntries(res.body.map((r: Row) => [r.id, r.updated_at]))).toEqual({
      a: "2031-03-04T05:06:07.000Z",
      b: "2031-03-08T09:10:11.000Z",
    });
  });
});
