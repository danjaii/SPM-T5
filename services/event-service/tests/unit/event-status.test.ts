import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fake Supabase (in memory) so tests never touch the real database
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

/** `refuse`: the error change_event_status raises instead of saving, as the events_safety_gate trigger (migration 37) does. */
function createFake(refuse?: { code: string; message: string }) {
  const sessions = new Map<string, string>(); // login token -> user id
  const tables: Record<string, Row[]> = { users: [], events: [], event_status_history: [] };

  const query = (table: string) => {
    const filters: [string, unknown][] = [];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push([col, val]); return builder; },
      maybeSingle: async () => {
        const rows = tables[table].filter((r) => filters.every(([col, val]) => r[col] === val));
        return { data: rows[0] ? { ...rows[0] } : null, error: null }; // a copy, like a real database sends
      },
    };
    return builder;
  };

  /** Pretends to be the change_event_status database function (supabase/migrations/04_change_event_status.sql). */
  const changeEventStatus = (callerId: string | undefined, args: Row) => {
    if (refuse) return { data: null, error: refuse };
    const event = tables.events.find((e) => e.id === args.p_event_id);
    if (!event) return { data: null, error: null };
    tables.event_status_history.push({
      event_id: event.id,
      old_status: event.status,
      new_status: args.p_new_status,
      changed_by: callerId,
      reason: args.p_reason ?? null,
    });
    event.status = args.p_new_status;
    return { data: { id: event.id, name: event.name, status: event.status }, error: null };
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
    forUser: (token: string) => ({
      from: (table: string) => query(table),
      rpc: (fn: string, args: Row) => ({
        maybeSingle: async () => {
          if (fn !== "change_event_status") throw new Error(`fake has no function ${fn}`);
          return changeEventStatus(sessions.get(token), args); // like auth.uid(): the caller comes from their token
        },
      }),
    }),
  } as unknown as SupabaseDeps;

  /** Pretends a user with this role is logged in; returns the cookie their browser would send. */
  const signIn = (role: string) => {
    const id = crypto.randomUUID();
    tables.users.push({ id, role, full_name: "Test User", is_active: true });
    sessions.set(`token-${id}`, id);
    return { id, cookie: `cs_session=token-${id}` };
  };

  return { deps, tables, signIn };
}
// end of fake Supabase

// ---------------------------------------------------------------------------
// SCRUM-6 — [Event Status Management] View Event Status as Event Coordinator
// ---------------------------------------------------------------------------
describe("SCRUM-6 — View event status as event coordinator", () => {
  // AC1: an event coordinator sees the event's current status
  it("shows the assigned coordinator the event's current status", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "under_review", assigned_coordinator_id: coordinator.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps)).get(`/events/${event.id}`).set("Cookie", coordinator.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: event.id, name: "Tech Summit", status: "under_review" });
  });

  // AC1 (extra): the AC doesn't restrict viewing to the assigned coordinator, so an unassigned one can see it too
  it("shows a coordinator the status of an event assigned to someone else", async () => {
    const fake = createFake();
    const coordinatorA = fake.signIn("event_coordinator");
    const coordinatorB = fake.signIn("event_coordinator");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "under_review", assigned_coordinator_id: coordinatorB.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps)).get(`/events/${event.id}`).set("Cookie", coordinatorA.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: event.id, name: "Tech Summit", status: "under_review" });
  });
  // end of AC1

  // AC2: after the status changes, the coordinator sees the latest status, not a previous one
  it("shows the latest status after it changes", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "under_review", assigned_coordinator_id: coordinator.id };
    fake.tables.events.push(event);
    const app = createApp(fake.deps);

    const before = await request(app).get(`/events/${event.id}`).set("Cookie", coordinator.cookie);
    event.status = "approved"; // someone changes the status (e.g. via SCRUM-8)
    const after = await request(app).get(`/events/${event.id}`).set("Cookie", coordinator.cookie);

    expect(before.body.status).toBe("under_review");
    expect(after.body.status).toBe("approved");
  });
  // end of AC2

  // AC3: attendees, venue staff and technical support staff cannot see event status
  it.each(["attendee", "venue_staff", "technical_support_staff"])("refuses a %s with 403", async (role) => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    const outsider = fake.signIn(role);
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "under_review", assigned_coordinator_id: coordinator.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps)).get(`/events/${event.id}`).set("Cookie", outsider.cookie);

    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty("status");
  });
  // end of AC3
});
// end of SCRUM-6

// ---------------------------------------------------------------------------
// SCRUM-7 — [Event Status Management] View Event Status as the Event Organiser
// ---------------------------------------------------------------------------
describe("SCRUM-7 — View event status as the event organiser", () => {
  // AC1: the organiser who submitted the event sees its current status
  it("shows the organiser who submitted the event its current status", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "submitted", organiser_id: organiser.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps)).get(`/events/${event.id}`).set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: event.id, name: "Tech Summit", status: "submitted" });
  });
  // end of AC1

  // AC2: after the status changes, the organiser sees the latest status, not a previous one
  it("shows the organiser the latest status after it changes", async () => {
    const fake = createFake();
    const organiser = fake.signIn("event_organiser");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "submitted", organiser_id: organiser.id };
    fake.tables.events.push(event);
    const app = createApp(fake.deps);

    const before = await request(app).get(`/events/${event.id}`).set("Cookie", organiser.cookie);
    event.status = "under_review"; // a coordinator picks it up
    const after = await request(app).get(`/events/${event.id}`).set("Cookie", organiser.cookie);

    expect(before.body.status).toBe("submitted");
    expect(after.body.status).toBe("under_review");
  });
  // end of AC2

  // AC3: an organiser who did not submit the event cannot see it (404, so they can't tell it exists)
  it("hides another organiser's event with 404", async () => {
    const fake = createFake();
    const owner = fake.signIn("event_organiser");
    const otherOrganiser = fake.signIn("event_organiser");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "submitted", organiser_id: owner.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps)).get(`/events/${event.id}`).set("Cookie", otherOrganiser.cookie);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Event not found." });
  });
  // end of AC3
});
// end of SCRUM-7

// ---------------------------------------------------------------------------
// SCRUM-8 — [Event Status Management] Edit Event Status
// ---------------------------------------------------------------------------
describe("SCRUM-8 — Edit event status", () => {
  // AC1: an event coordinator can change an event's status
  it("lets a coordinator change an event's status", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "under_review", assigned_coordinator_id: coordinator.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps))
      .patch(`/events/${event.id}/status`)
      .set("Cookie", coordinator.cookie)
      .send({ status: "approved" });

    expect(res.status).toBe(200);
    expect(event.status).toBe("approved"); // the change was saved in the database
  });
  // end of AC1

  // AC2: the coordinator receives confirmation once the status has been updated
  it("confirms the change by returning the event with its new status", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "under_review", assigned_coordinator_id: coordinator.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps))
      .patch(`/events/${event.id}/status`)
      .set("Cookie", coordinator.cookie)
      .send({ status: "approved" });

    expect(res.body).toEqual({ id: event.id, name: "Tech Summit", status: "approved" });
  });
  // end of AC2

  // AC3: an invalid status is refused with a message, and the status stays the same
  // made-up word, wrong capitalisation, missing entirely, not text
  it.each(["banana", "Approved", undefined, 123])("refuses status %j and leaves the event unchanged", async (badStatus) => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "under_review", assigned_coordinator_id: coordinator.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps))
      .patch(`/events/${event.id}/status`)
      .set("Cookie", coordinator.cookie)
      .send({ status: badStatus });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid status." });
    expect(event.status).toBe("under_review"); // nothing was saved
  });
  // end of AC3

  // AC4: only event coordinators can change an event's status
  it.each(["event_organiser", "attendee", "venue_staff", "technical_support_staff"])(
    "refuses a %s with 403 and leaves the event unchanged",
    async (role) => {
      const fake = createFake();
      const outsider = fake.signIn(role);
      const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "under_review", organiser_id: outsider.id };
      fake.tables.events.push(event);

      const res = await request(createApp(fake.deps))
        .patch(`/events/${event.id}/status`)
        .set("Cookie", outsider.cookie)
        .send({ status: "approved" });

      expect(res.status).toBe(403);
      expect(event.status).toBe("under_review"); // nothing was saved
    },
  );
  // end of AC4

  // AC6: only the coordinator assigned to the event can change its status
  it("refuses a coordinator who isn't assigned to the event with 403", async () => {
    const fake = createFake();
    const assigned = fake.signIn("event_coordinator");
    const otherCoordinator = fake.signIn("event_coordinator");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "under_review", assigned_coordinator_id: assigned.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps))
      .patch(`/events/${event.id}/status`)
      .set("Cookie", otherCoordinator.cookie)
      .send({ status: "approved" });

    expect(res.status).toBe(403);
    expect(event.status).toBe("under_review"); // nothing was saved
    expect(fake.tables.event_status_history).toEqual([]); // and nothing was recorded
  });
  // end of AC6

  // AC5: every change is recorded in the status history (who, old -> new, optional reason)
  it("records the change in the status history", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "under_review", assigned_coordinator_id: coordinator.id };
    fake.tables.events.push(event);

    await request(createApp(fake.deps))
      .patch(`/events/${event.id}/status`)
      .set("Cookie", coordinator.cookie)
      .send({ status: "returned", reason: "Please add the expected attendance." });

    expect(fake.tables.event_status_history).toEqual([
      {
        event_id: event.id,
        old_status: "under_review",
        new_status: "returned",
        changed_by: coordinator.id,
        reason: "Please add the expected attendance.",
      },
    ]);
  });
  // end of AC5

  // SCRUM-47/AC10 (and SCRUM-24/AC2): a rejection needs a reason here too, as on the Reject button; refused, it is not
  // recorded, so the organiser is not told
  it("SCRUM-47/AC10 refuses a rejection with no reason, and records nothing", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "planning", assigned_coordinator_id: coordinator.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps))
      .patch(`/events/${event.id}/status`)
      .set("Cookie", coordinator.cookie)
      .send({ status: "rejected", reason: "   " });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "A reason is required to reject an event." });
    expect(event.status).toBe("planning");
    expect(fake.tables.event_status_history).toEqual([]);
  });

  // Edge case (not an AC): changing the status of an event that doesn't exist
  it("returns 404 and records nothing when the event doesn't exist", async () => {
    const fake = createFake();
    const coordinator = fake.signIn("event_coordinator");

    const res = await request(createApp(fake.deps))
      .patch(`/events/${crypto.randomUUID()}/status`)
      .set("Cookie", coordinator.cookie)
      .send({ status: "approved" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Event not found." });
    expect(fake.tables.event_status_history).toEqual([]); // no history for an event that isn't there
  });
  // end of edge case

  // For the UI: viewing an event says whether the viewer may change its status (so the page knows to show the dropdown)
  it("tells the assigned coordinator they can change the status, and others they can't", async () => {
    const fake = createFake();
    const assigned = fake.signIn("event_coordinator");
    const otherCoordinator = fake.signIn("event_coordinator");
    const organiser = fake.signIn("event_organiser");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "under_review", assigned_coordinator_id: assigned.id, organiser_id: organiser.id };
    fake.tables.events.push(event);
    const app = createApp(fake.deps);
    const view = (cookie: string) => request(app).get(`/events/${event.id}`).set("Cookie", cookie);

    expect((await view(assigned.cookie)).body.canChangeStatus).toBe(true);
    expect((await view(otherCoordinator.cookie)).body.canChangeStatus).toBe(false);
    expect((await view(organiser.cookie)).body.canChangeStatus).toBe(false);
  });

  // SCRUM-24/AC5: approve/reject actions are offered to the assigned coordinator only
  it("SCRUM-24/AC5: tells only the assigned coordinator they can approve or reject", async () => {
    const fake = createFake();
    const assigned = fake.signIn("event_coordinator");
    const otherCoordinator = fake.signIn("event_coordinator");
    const organiser = fake.signIn("event_organiser");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "submitted", assigned_coordinator_id: assigned.id, organiser_id: organiser.id };
    fake.tables.events.push(event);
    const app = createApp(fake.deps);
    const view = (cookie: string) => request(app).get(`/events/${event.id}`).set("Cookie", cookie);

    expect((await view(assigned.cookie)).body.canReview).toBe(true);
    expect((await view(otherCoordinator.cookie)).body.canReview).toBe(false);
    expect((await view(organiser.cookie)).body.canReview).toBe(false);
  });
  // end of UI support
});
// end of SCRUM-8

// SCRUM-116/AC3: the Safety Officer checks the event, but moving it on is not theirs to do
describe("SCRUM-116/AC3 a Safety Officer cannot move an event to preparation directly", () => {
  it("SCRUM-116/AC3 refuses a Safety Officer's status change with 403 and leaves the event unchanged", async () => {
    const fake = createFake();
    const safetyOfficer = fake.signIn("safety_officer");
    const coordinator = fake.signIn("event_coordinator");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "awaiting_arrangements", assigned_coordinator_id: coordinator.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps))
      .patch(`/events/${event.id}/status`)
      .set("Cookie", safetyOfficer.cookie)
      .send({ status: "confirmed" });

    expect(res.status).toBe(403);
    expect(event.status).toBe("awaiting_arrangements"); // nothing was saved
    expect(fake.tables.event_status_history).toEqual([]);
  });
});

// SCRUM-99/AC7: the events_safety_gate trigger (migration 37) refuses confirmed without a Safety Approved check
describe("SCRUM-99/AC7 an event cannot skip the safety check", () => {
  it("SCRUM-99/AC7 answers 409 when the database refuses to confirm an event that is not Safety Approved", async () => {
    const fake = createFake({ code: "SC001", message: "Event has not been Safety Approved" });
    const coordinator = fake.signIn("event_coordinator");
    const event = { id: crypto.randomUUID(), name: "Tech Summit", status: "awaiting_arrangements", assigned_coordinator_id: coordinator.id };
    fake.tables.events.push(event);

    const res = await request(createApp(fake.deps))
      .patch(`/events/${event.id}/status`)
      .set("Cookie", coordinator.cookie)
      .send({ status: "confirmed" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "This event can't move to preparation until it is Safety Approved." });
    expect(event.status).toBe("awaiting_arrangements");
  });
});
