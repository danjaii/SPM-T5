import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

/**
 * SCRUM-111: PATCH /events/:id, the assigned coordinator edits an event's details (docs/specs/edit-event-details.md). The
 * database saves the edit and its history row together (update_event_details(), migration 34; tests/integration); these
 * cover the route's own checks and how it turns the function's answers into responses.
 */

// ----------------------------------------------------------------------------
// Test setup: "Tech Summit" (Sat 12 Dec 2026, 9am-5pm Singapore time, 120 people), assigned to the coordinator
// "user-token-coordinator"; the edit form filled in with its current values
// ----------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string } | null };

const ROLES: Record<string, string> = {
  "token-coordinator": "event_coordinator",
  "token-other-coordinator": "event_coordinator",
  "token-lead": "event_coordinator_lead",
  "token-organiser": "event_organiser",
  "token-venue": "venue_staff",
  "token-tech": "technical_support_staff",
  "token-attendee": "attendee",
};

const anEvent = (over: Row = {}): Row => ({
  id: "evt-1",
  status: "planning",
  assigned_coordinator_id: "user-token-coordinator",
  name: "Tech Summit",
  description: "Annual summit",
  purpose: "Networking",
  event_category_id: "cat-conference",
  preferred_start_datetime: "2026-12-12T01:00:00+00:00",
  preferred_end_datetime: "2026-12-12T09:00:00+00:00",
  expected_attendance: 120,
  preferred_room_layout_id: "layout-theatre",
  accessibility_requirements: "Wheelchair access",
  venue_requirements: "Stage",
  equipment_requirements_notes: "Two projectors",
  ...over,
});

const form = {
  name: "Tech Summit",
  description: "Annual summit",
  purpose: "Networking",
  categoryId: "cat-conference",
  date: "2026-12-12",
  startTime: "09:00",
  endDate: "2026-12-12",
  endTime: "17:00",
  expectedAttendance: 120,
  roomLayoutId: "layout-theatre",
  accessibilityRequirements: "Wheelchair access",
  venueRequirements: "Stage",
  equipmentRequirements: "Two projectors",
};

function makeApp({ event = anEvent() as Row | null, save = { data: true, error: null } as Result } = {}) {
  const rpc = vi.fn(async () => save);
  const deps = {
    anon: {
      auth: {
        getUser: async (token: string) =>
          ROLES[token] ? { data: { user: { id: `user-${token}` } }, error: null } : { data: { user: null }, error: { message: "bad" } },
      },
    },
    forUser: (token: string) => ({
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => (table === "users" ? { data: { role: ROLES[token] }, error: null } : { data: event, error: null }),
            // SCRUM-112: an important change reads the event's venue bookings and equipment requests; here it has none
            then: (resolve: (r: Result) => void) => resolve({ data: [], error: null }),
          }),
        }),
      }),
      rpc,
    }),
  } as unknown as SupabaseDeps;
  const app = createApp(deps, { now: () => new Date("2026-10-01T00:00:00.000Z") });
  const edit = (body: object, token: string | null = "token-coordinator", id = "evt-1") => {
    const req = request(app).patch(`/events/${id}`).send({ ...form, ...body });
    return token ? req.set("Cookie", `cs_session=${token}`) : req;
  };
  return { edit, rpc };
}

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-111/AC1, AC2, AC4 saving an edit
// ----------------------------------------------------------------------------

describe("SCRUM-111/AC1, AC2, AC4 PATCH /events/:id saves the edit (111-S1, 111-S3, 111-S6, 111-S11)", () => {
  // the database saves the event and its history row together; the route sends exactly what changed
  it("111-S1 ordinary changes are sent to update_event_details as { from, to }, not important, and returned", async () => {
    const { edit, rpc } = makeApp();

    const res = await edit({ name: "Tech Summit 2026", purpose: "Learning" });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_event_details", {
      p_event_id: "evt-1",
      p_changes: { name: { from: "Tech Summit", to: "Tech Summit 2026" }, purpose: { from: "Networking", to: "Learning" } },
    });
    expect(res.body).toEqual({
      changes: { name: { from: "Tech Summit", to: "Tech Summit 2026" }, purpose: { from: "Networking", to: "Learning" } },
      important: false,
      message: "Event details saved.",
    });
  });

  // the database works "important" out itself from the fields (migration 34); the reply says so for the page
  it("111-S6 an important change (attendance 120 to 150) is reported as important", async () => {
    const { edit, rpc } = makeApp();

    const res = await edit({ expectedAttendance: 150 });

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_event_details", { p_event_id: "evt-1", p_changes: { expected_attendance: { from: 120, to: 150 } } });
    expect(res.body.important).toBe(true);
  });

  // a Confirmed event can still be edited (the brief: changes happen "even after it has been confirmed")
  it.each(["submitted", "under_review", "returned", "approved", "planning", "awaiting_arrangements", "confirmed"])(
    "111-S3 a %s event can be edited",
    async (status) => {
      const { edit } = makeApp({ event: anEvent({ status }) });

      expect((await edit({ purpose: "Learning" })).status).toBe(200);
    },
  );
});

// ----------------------------------------------------------------------------
// SCRUM-111/AC3 required information and valid values; AC4 nothing changed
// ----------------------------------------------------------------------------

describe("SCRUM-111/AC3, AC4 refusals before saving (111-S7, 111-S8, 111-S9, 111-S12)", () => {
  it("111-S7 required information left empty: 422 with what is required, and nothing is saved", async () => {
    const { edit, rpc } = makeApp();

    const res = await edit({ name: "", expectedAttendance: "" });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      code: "VALIDATION_FAILED",
      error: "Some fields need attention.",
      fieldErrors: { name: "Enter the event name.", expectedAttendance: "Enter the expected attendance." },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("111-S8 an end before the start: 422, and nothing is saved", async () => {
    const { edit, rpc } = makeApp();

    const res = await edit({ endTime: "08:00" });

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ endTime: "End time must be after the start time." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("111-S12 nothing different: 409 NO_CHANGES, and nothing is saved", async () => {
    const { edit, rpc } = makeApp();

    const res = await edit({});

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "NO_CHANGES", error: "Nothing was changed." });
    expect(rpc).not.toHaveBeenCalled();
  });

  // the database's foreign keys refuse a category or layout that does not exist
  it.each([
    ["category", "events_event_category_id_fkey", "categoryId", "Choose a category from the list."],
    ["room layout", "events_preferred_room_layout_id_fkey", "roomLayoutId", "Choose a room layout from the list."],
  ])("111-S9 an unknown %s: 422 on that field", async (_name, constraint, field, message) => {
    const { edit } = makeApp({ save: { data: null, error: { code: "23503", message: `violates foreign key constraint "${constraint}"` } } });

    const res = await edit({ categoryId: "nope" });

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ [field]: message });
  });
});

// ----------------------------------------------------------------------------
// SCRUM-111/AC6 finished events; AC7 only the assigned coordinator
// ----------------------------------------------------------------------------

describe("SCRUM-111/AC6, AC7 who may edit, and when (111-S16 to 111-S18)", () => {
  it.each(["completed", "cancelled", "rejected"])("111-S16 a %s event can't be edited: 409 EVENT_LOCKED, and nothing is saved", async (status) => {
    const { edit, rpc } = makeApp({ event: anEvent({ status }) });

    const res = await edit({ purpose: "Learning" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "EVENT_LOCKED", error: "A completed, cancelled or rejected event can't be edited." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("111-S17 a coordinator the event is not assigned to: 403, and nothing is saved", async () => {
    const { edit, rpc } = makeApp();

    const res = await edit({ purpose: "Learning" }, "token-other-coordinator");

    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["token-lead", "token-organiser", "token-venue", "token-tech", "token-attendee"])("111-S17 %s: 403", async (token) => {
    const { edit, rpc } = makeApp();

    expect((await edit({ purpose: "Learning" }, token)).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  // the role is checked first, so someone who may never edit events learns nothing, not even whether one exists
  it("111-S17 venue staff editing an event that does not exist: 403, not 404", async () => {
    expect((await makeApp({ event: null }).edit({ purpose: "Learning" }, "token-venue")).status).toBe(403);
  });

  it("111-S17 someone not signed in: 401", async () => {
    expect((await makeApp().edit({ purpose: "Learning" }, null)).status).toBe(401);
  });

  // the Lead moved the event to another coordinator (SCRUM-79), so the one it was moved away from can no longer edit it
  it("111-S18 the coordinator the event was moved away from: 403", async () => {
    const { edit } = makeApp({ event: anEvent({ assigned_coordinator_id: "user-token-other-coordinator" }) });

    expect((await edit({ purpose: "Learning" })).status).toBe(403);
  });

  it("an event that does not exist, or that the coordinator can't see: 404", async () => {
    expect((await makeApp({ event: null }).edit({ purpose: "Learning" })).status).toBe(404);
  });
});

// ----------------------------------------------------------------------------
// The database function's own refusals (it checks again, in case something changed since the route looked)
// ----------------------------------------------------------------------------

describe("SCRUM-111 update_event_details refusals", () => {
  it.each([
    ["42501 (not the assigned coordinator)", "42501", 403, undefined],
    ["CS111 (changed by someone else meanwhile)", "CS111", 409, "STALE"],
    ["CS112 (finished meanwhile)", "CS112", 409, "EVENT_LOCKED"],
  ])("%s", async (_name, code, status, errorCode) => {
    const { edit } = makeApp({ save: { data: null, error: { code, message: "raw database message" } } });

    const res = await edit({ purpose: "Learning" });

    expect(res.status).toBe(status);
    if (errorCode) expect(res.body.code).toBe(errorCode);
    expect(JSON.stringify(res.body)).not.toContain("raw database message");
  });

  it("anything else is a general error, without the database's message", async () => {
    const { edit } = makeApp({ save: { data: null, error: { code: "XX000", message: "raw database message" } } });

    const res = await edit({ purpose: "Learning" });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "We couldn't save the event details. Please try again." });
  });
});
// end of SCRUM-111
