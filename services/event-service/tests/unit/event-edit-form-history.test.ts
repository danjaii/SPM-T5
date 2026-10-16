import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-111: GET /events/:id/edit-form (what the edit form starts with) and GET /events/:id/change-history (what was changed,
 * by whom and when). docs/specs/edit-event-details.md.
 */

// ----------------------------------------------------------------------------
// Test setup: "Tech Summit" (Sat 12 Dec 2026, 9am-5pm Singapore time), assigned to "user-token-coordinator", organised by
// "user-token-organiser"; two categories, two room layouts, and two saved edits in its history
// ----------------------------------------------------------------------------

type Row = Record<string, unknown>;

const ROLES: Record<string, string> = {
  "token-coordinator": "event_coordinator",
  "token-other-coordinator": "event_coordinator",
  "token-organiser": "event_organiser",
  "token-other-organiser": "event_organiser",
  "token-lead": "event_coordinator_lead",
  "token-venue": "venue_staff",
  "token-attendee": "attendee",
};

const anEvent = (over: Row = {}): Row => ({
  id: "evt-1",
  status: "planning",
  assigned_coordinator_id: "user-token-coordinator",
  organiser_id: "user-token-organiser",
  name: "Tech Summit",
  description: "Annual summit",
  purpose: null,
  event_category_id: "cat-conference",
  preferred_start_datetime: "2026-12-12T01:00:00+00:00",
  preferred_end_datetime: "2026-12-12T09:00:00+00:00",
  expected_attendance: 120,
  preferred_room_layout_id: "layout-theatre",
  accessibility_requirements: null,
  venue_requirements: "Stage",
  equipment_requirements_notes: null,
  ...over,
});

const categories = [
  { id: "cat-conference", name: "Conference" },
  { id: "cat-workshop", name: "Workshop" },
];
const layouts = [
  { id: "layout-banquet", name: "Banquet" },
  { id: "layout-theatre", name: "Theatre" },
];

// newest first, as the database returns them
const history = [
  {
    id: "h-2",
    changed_at: "2026-10-05T03:00:00+00:00",
    is_important: true,
    changer: { full_name: "Rachel Tan" },
    changes: {
      expected_attendance: { from: 100, to: 120 },
      preferred_room_layout_id: { from: "layout-banquet", to: "layout-theatre" },
      event_category_id: { from: null, to: "cat-conference" },
    },
  },
  {
    id: "h-1",
    changed_at: "2026-10-02T03:00:00+00:00",
    is_important: false,
    changer: { full_name: "Rachel Tan" },
    changes: { name: { from: "Summit", to: "Tech Summit" } },
  },
];

function makeApp({ event = anEvent() as Row | null, historyRows = history as Row[] } = {}) {
  const tables: Record<string, Row[]> = { event_categories: categories, room_layouts: layouts, event_change_history: historyRows };
  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) =>
          ROLES[token] ? { data: { user: { id: `user-${token}` } }, error: null } : { data: { user: null }, error: { message: "bad" } },
      },
    },
    forUser: (token: string) => ({
      from: (table: string) => ({
        select: () => {
          const list = { data: tables[table] ?? [], error: null };
          return {
            order: async () => list,
            eq: () => ({
              order: async () => list,
              maybeSingle: async () => (table === "users" ? { data: { role: ROLES[token] }, error: null } : { data: event, error: null }),
            }),
          };
        },
      }),
    }),
  } as unknown as SupabaseDeps;
  const app = createApp(deps);
  const get = (path: string, token: string | null) => {
    const req = request(app).get(path);
    return token ? req.set("Cookie", `cs_session=${token}`) : req;
  };
  return {
    form: (token: string | null = "token-coordinator", id = "evt-1") => get(`/events/${id}/edit-form`, token),
    changes: (token: string | null = "token-coordinator", id = "evt-1") => get(`/events/${id}/change-history`, token),
  };
}

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-111/AC2 the edit form
// ----------------------------------------------------------------------------

describe("SCRUM-111/AC2 GET /events/:id/edit-form (111-S4)", () => {
  it("111-S4 gives the current values as the form shows them (Singapore time), the categories and layouts, and which fields are important", async () => {
    const res = await makeApp().form();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      values: {
        name: "Tech Summit",
        description: "Annual summit",
        purpose: "",
        categoryId: "cat-conference",
        date: "2026-12-12",
        startTime: "09:00",
        endDate: "2026-12-12",
        endTime: "17:00",
        expectedAttendance: 120,
        roomLayoutId: "layout-theatre",
        accessibilityRequirements: "",
        venueRequirements: "Stage",
        equipmentRequirements: "",
      },
      categories,
      roomLayouts: layouts,
      importantFields: ["date", "startTime", "endDate", "endTime", "expectedAttendance", "roomLayoutId", "accessibilityRequirements", "venueRequirements", "equipmentRequirements"],
    });
  });

  it("111-S4 an event with no dates or attendance yet starts with them empty", async () => {
    const res = await makeApp({ event: anEvent({ preferred_start_datetime: null, preferred_end_datetime: null, expected_attendance: null }) }).form();

    expect(res.body.values).toMatchObject({ date: "", startTime: "", endDate: "", endTime: "", expectedAttendance: "" });
  });

  it.each(["completed", "cancelled", "rejected"])("111-S16 a %s event has no edit form: 409 EVENT_LOCKED", async (status) => {
    const res = await makeApp({ event: anEvent({ status }) }).form();

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVENT_LOCKED");
  });

  it.each(["token-other-coordinator", "token-organiser", "token-lead", "token-venue", "token-attendee"])("111-S17 %s gets no edit form: 403", async (token) => {
    expect((await makeApp().form(token)).status).toBe(403);
  });

  it("111-S17 not signed in: 401; an event that does not exist: 404", async () => {
    expect((await makeApp().form(null)).status).toBe(401);
    expect((await makeApp({ event: null }).form()).status).toBe(404);
  });
});

// ----------------------------------------------------------------------------
// SCRUM-111/AC4 the change history
// ----------------------------------------------------------------------------

describe("SCRUM-111/AC4 GET /events/:id/change-history (111-S13, 111-S14)", () => {
  // each save: when, who, whether it was important, and each field's label with its old and new value; categories and
  // layouts by name, not id
  it("111-S13 the coordinator sees each save, newest first, with readable fields and values", async () => {
    const res = await makeApp().changes();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: "h-2",
        changedAt: "2026-10-05T03:00:00+00:00",
        changedBy: "Rachel Tan",
        important: true,
        // always in the form's order (ordinary fields first), whatever order the database keeps them in
        changes: [
          { field: "event_category_id", label: "Category", from: null, to: "Conference" },
          { field: "expected_attendance", label: "Expected attendance", from: 100, to: 120 },
          { field: "preferred_room_layout_id", label: "Room layout", from: "Banquet", to: "Theatre" },
        ],
      },
      {
        id: "h-1",
        changedAt: "2026-10-02T03:00:00+00:00",
        changedBy: "Rachel Tan",
        important: false,
        changes: [{ field: "name", label: "Event name", from: "Summit", to: "Tech Summit" }],
      },
    ]);
  });

  it("111-S13 the event's organiser sees it too", async () => {
    const res = await makeApp().changes("token-organiser");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("111-S13 an event with no edits yet has an empty history", async () => {
    expect((await makeApp({ historyRows: [] }).changes()).body).toEqual([]);
  });

  // another organiser's event looks like one that does not exist, as on the event page (SCRUM-7/AC3)
  it("111-S14 another organiser: 404", async () => {
    expect((await makeApp().changes("token-other-organiser")).status).toBe(404);
  });

  it.each(["token-other-coordinator", "token-lead", "token-venue", "token-attendee"])("111-S14 %s: 403", async (token) => {
    expect((await makeApp().changes(token)).status).toBe(403);
  });

  it("111-S14 not signed in: 401; an event that does not exist: 404", async () => {
    expect((await makeApp().changes(null)).status).toBe(401);
    expect((await makeApp({ event: null }).changes()).status).toBe(404);
  });
});
// end of SCRUM-111
