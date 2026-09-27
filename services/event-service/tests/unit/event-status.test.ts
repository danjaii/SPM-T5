import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";

// ---------------------------------------------------------------------------
// Fake Supabase (in memory) so tests never touch the real database
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function createFake() {
  const sessions = new Map<string, string>(); // login token -> user id
  const tables: Record<string, Row[]> = { users: [], events: [] };

  const query = (table: string) => {
    let rows = [...tables[table]];
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return builder; },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
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
