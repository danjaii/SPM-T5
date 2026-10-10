import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fake Supabase (in memory) so tests never touch the real database. It does not enforce RLS: the
// organiser/status checks it covers are the route's own, and the policy is covered by
// tests/integration/eventChangeRequestRls.test.ts.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function createFake() {
  const sessions = new Map<string, string>();
  const tables: Record<string, Row[]> = { users: [], events: [], event_change_requests: [] };
  let insertError: { code: string; message?: string } | null = null;
  let beforeInsertFails: (() => void) | undefined;

  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    let orderBy: string | undefined;
    const matching = () => tables[table].filter((r) => filters.every(([col, val]) => r[col] === val));
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
      order: (col: string) => { orderBy = col; return builder; },
      maybeSingle: async () => ({ data: matching()[0] ? { ...matching()[0] } : null, error: null }),
      insert: (row: Row) => {
        if (insertError) beforeInsertFails?.();
        const stored = insertError ? undefined : { id: crypto.randomUUID(), requested_at: new Date().toISOString(), ...row };
        if (stored) tables[table].push(stored);
        return { select: () => ({ single: async () => ({ data: stored ?? null, error: insertError }) }) };
      },
      // awaiting the builder (the list route) resolves the rows, newest first
      then: (resolve: (v: unknown) => void) => {
        const rows = matching().map((r) => ({ ...r }));
        if (orderBy) rows.sort((a, b) => String(b[orderBy!]).localeCompare(String(a[orderBy!])));
        resolve({ data: rows, error: null });
      },
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
    forUser: () => ({ from: (table: string) => query(table) }),
  } as unknown as SupabaseDeps;

  const signIn = (role: string) => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: "Test User", is_active: true });
    sessions.set(`token-${id}`, id);
    return { id, cookie: `cs_session=token-${id}` };
  };

  const addEvent = (organiserId: string, status: string, extra: Row = {}) => {
    const event = {
      id: crypto.randomUUID(),
      organiser_id: organiserId,
      status,
      expected_attendance: 100,
      preferred_start_datetime: sgtToUtc("2031-11-14", "09:00").toISOString(),
      preferred_end_datetime: sgtToUtc("2031-11-14", "17:00").toISOString(),
      equipment_requirements_notes: "Two projectors",
      ...extra,
    };
    tables.events.push(event);
    return event;
  };

  return { deps, tables, signIn, addEvent, failInsertWith: (code: string, beforeFail?: () => void) => { insertError = { code, message: "denied" }; beforeInsertFails = beforeFail; } };
}

const post = (fake: ReturnType<typeof createFake>, eventId: string, cookie: string, body: unknown) =>
  request(createApp(fake.deps)).post(`/events/${eventId}/change-requests`).set("Cookie", cookie).send(body as object);

describe("SCRUM-66/AC1 an organiser creates a change request on a submitted event", () => {
  it("stores a pending request and returns 201", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = fake.addEvent(organiser.id, "submitted");

    const res = await post(fake, event.id, organiser.cookie, { expectedAttendance: 150, reason: "More sign-ups" });

    expect(res.status).toBe(201);
    expect(fake.tables.event_change_requests).toHaveLength(1);
    expect(fake.tables.event_change_requests[0]).toMatchObject({
      event_id: event.id,
      requested_by: organiser.id,
      status: "pending",
      change_description: "More sign-ups",
      proposed_changes: { expected_attendance: { from: 100, to: 150 } },
    });
  });

  it("refuses a coordinator and an attendee with 403", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = fake.addEvent(organiser.id, "submitted");
    for (const role of ["event_coordinator", "attendee"]) {
      const res = await post(fake, event.id, fake.signIn(role).cookie, { expectedAttendance: 150 });
      expect(res.status).toBe(403);
    }
    expect(fake.tables.event_change_requests).toHaveLength(0);
  });

  it("answers 404 for someone else's event, as if it did not exist", async () => {
    const fake = createFake();
    const owner = fake.signIn("event_organiser");
    const other = fake.signIn("event_organiser");
    const event = fake.addEvent(owner.id, "submitted");

    expect((await post(fake, event.id, other.cookie, { expectedAttendance: 150 })).status).toBe(404);
    expect((await post(fake, crypto.randomUUID(), owner.cookie, { expectedAttendance: 150 })).status).toBe(404);
  });

  it("answers 401 when not signed in", async () => {
    const fake = createFake();
    const res = await request(createApp(fake.deps)).post(`/events/${crypto.randomUUID()}/change-requests`).send({});
    expect(res.status).toBe(401);
  });
});

describe("SCRUM-66/AC2 and AC3 events that cannot be changed by request", () => {
  it.each(["cancelled", "rejected", "completed", "draft"])("refuses a %s event with 409 and stores nothing", async (status) => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = fake.addEvent(organiser.id, status);

    const res = await post(fake, event.id, organiser.cookie, { expectedAttendance: 150 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_ALLOWED");
    expect(fake.tables.event_change_requests).toHaveLength(0);
  });

  it("reports a conflict when the status changed to a blocked one between the check and the insert", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = fake.addEvent(organiser.id, "submitted");
    fake.failInsertWith("42501", () => { fake.tables.events.find((e) => e.id === event.id)!.status = "cancelled"; });

    const res = await post(fake, event.id, organiser.cookie, { expectedAttendance: 150 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("NOT_ALLOWED");
  });

  // Regression: a database that refused the insert for another reason (e.g. migration 15's policy missing) used to be
  // reported as "can't be made for a draft, cancelled, rejected or completed event" even for a planning event.
  it.each(["42501", "23503", "XX000"])("says the request couldn't be saved, not that the status is blocked, when the insert fails with %s on a still-allowed event", async (code) => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = fake.addEvent(organiser.id, "planning");
    fake.failInsertWith(code);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(fake, event.id, organiser.cookie, { expectedAttendance: 150 });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("SAVE_FAILED");
    expect(res.body.error).not.toMatch(/draft|cancelled|rejected|completed/);
    expect(log).toHaveBeenCalled();
    expect(fake.tables.event_change_requests).toHaveLength(0);
    log.mockRestore();
  });
});

describe("SCRUM-66/AC4 no detail changed", () => {
  it("submits nothing and says no changes were made", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = fake.addEvent(organiser.id, "submitted");

    const res = await post(fake, event.id, organiser.cookie, { expectedAttendance: 100, equipmentRequirements: "Two projectors" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "NO_CHANGES", error: expect.stringMatching(/no changes/i) });
    expect(fake.tables.event_change_requests).toHaveLength(0);
  });
});

describe("SCRUM-66/AC5 expected attendance must be a positive whole number", () => {
  it.each([0, -1, 2.5, "abc"])("refuses %s with a field error", async (value) => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = fake.addEvent(organiser.id, "submitted");

    const res = await post(fake, event.id, organiser.cookie, { expectedAttendance: value });

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors.expectedAttendance).toMatch(/positive whole number/);
    expect(fake.tables.event_change_requests).toHaveLength(0);
  });
});

describe("SCRUM-66/AC6 a valid request leaves the event unchanged until approved", () => {
  it("says it was submitted and does not touch the event", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = fake.addEvent(organiser.id, "approved");
    const before = { ...event };

    const res = await post(fake, event.id, organiser.cookie, { expectedAttendance: 150, venueRequirements: "Step-free access" });

    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/submitted for approval/);
    expect(res.body.proposed_changes).toEqual({
      expected_attendance: { from: 100, to: 150 },
      venue_requirements: { from: null, to: "Step-free access" },
    });
    expect(fake.tables.events[0]).toEqual(before);
  });
});

describe("SCRUM-66/AC7 viewing change requests shows each one's status", () => {
  it("lists the requests newest first with their status", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = fake.addEvent(organiser.id, "submitted");
    fake.tables.event_change_requests.push(
      { id: "1", event_id: event.id, status: "approved", requested_at: "2031-01-01T00:00:00Z", change_description: "old" },
      { id: "2", event_id: event.id, status: "pending", requested_at: "2031-02-01T00:00:00Z", change_description: "new" },
      { id: "3", event_id: crypto.randomUUID(), status: "rejected", requested_at: "2031-03-01T00:00:00Z", change_description: "other event" },
    );

    const res = await request(createApp(fake.deps)).get(`/events/${event.id}/change-requests`).set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body.map((r: Row) => [r.id, r.status])).toEqual([["2", "pending"], ["1", "approved"]]);
  });

  it("lets a coordinator read them but refuses an attendee", async () => {
    const fake = createFake();
    const event = fake.addEvent(fake.signIn("event_organiser").id, "submitted");
    const url = `/events/${event.id}/change-requests`;

    expect((await request(createApp(fake.deps)).get(url).set("Cookie", fake.signIn("event_coordinator").cookie)).status).toBe(200);
    expect((await request(createApp(fake.deps)).get(url).set("Cookie", fake.signIn("attendee").cookie)).status).toBe(403);
  });

  it("tells the event page whether the viewer may request a change", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const open = fake.addEvent(organiser.id, "submitted");
    const draft = fake.addEvent(organiser.id, "draft");
    const view = async (id: string, cookie: string) =>
      (await request(createApp(fake.deps)).get(`/events/${id}`).set("Cookie", cookie)).body;

    expect(await view(open.id, organiser.cookie)).toMatchObject({ isOrganiser: true, canRequestChange: true });
    expect(await view(draft.id, organiser.cookie)).toMatchObject({ isOrganiser: true, canRequestChange: false });
    expect(await view(open.id, fake.signIn("event_coordinator").cookie)).toMatchObject({ isOrganiser: false, canRequestChange: false });
  });
});

describe("SCRUM-66/AC8, AC9, AC10 editable fields and date and time rules", () => {
  it("accepts a new date and times, stored as UTC", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = fake.addEvent(organiser.id, "submitted");

    const res = await post(fake, event.id, organiser.cookie, { date: "2031-12-01", startTime: "10:00", endTime: "16:00" });

    expect(res.status).toBe(201);
    expect(res.body.proposed_changes.preferred_start_datetime.to).toBe(sgtToUtc("2031-12-01", "10:00").toISOString());
    expect(res.body.proposed_changes.preferred_end_datetime.to).toBe(sgtToUtc("2031-12-01", "16:00").toISOString());
  });

  it("AC9 refuses a date in the past", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = fake.addEvent(organiser.id, "submitted");

    const res = await post(fake, event.id, organiser.cookie, { date: "2020-01-01", startTime: "09:00", endTime: "17:00" });

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors.date).toMatch(/past/);
  });

  it("AC10 refuses an end time before the start time", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = fake.addEvent(organiser.id, "submitted");

    const res = await post(fake, event.id, organiser.cookie, { date: "2031-12-01", startTime: "15:00", endTime: "10:00" });

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors.endTime).toMatch(/after the start/);
  });
});
