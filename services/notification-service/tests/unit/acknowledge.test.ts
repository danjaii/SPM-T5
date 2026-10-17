import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { COOKIE, FakeAccess, FakeRepo, row, serve } from "../support/fakes";

/**
 * SCRUM-20/AC4, AC5: a technician acknowledges an on-site assignment notification
 * (docs/specs/technical-assignment-notifications.md). The database function checks and saves it
 * (acknowledge_technical_assignment(), migration 41; equipment-service tests/integration/technicalAssignments.test.ts);
 * these cover what the list says about it and how the route answers.
 */

// ----------------------------------------------------------------------------
// Test setup: user-1 is a technician with notifications about assignment ASG (assigned on 1 Oct, changed on 2 Oct),
// a cancelled assignment, and an ordinary one. user-2 has their own assignment notification.
// ----------------------------------------------------------------------------

const ASSIGNED = "00000000-0000-4000-8000-0000000000a1";
const CHANGED = "00000000-0000-4000-8000-0000000000a2";
const CANCELLED_NOTE = "00000000-0000-4000-8000-0000000000a3";
const ORDINARY = "00000000-0000-4000-8000-0000000000a4";
const OTHERS = "00000000-0000-4000-8000-0000000000a5";
const ASG = "33333333-3333-4333-8333-333333333333";
const GONE = "44444444-4444-4444-8444-444444444444";

let repo: FakeRepo;
let baseUrl: string;
let stop: () => Promise<unknown>;

function freshRepo() {
  const r = new FakeRepo([
    row({ id: ASSIGNED, type: "technical_assignment_assigned", technical_staff_assignment_id: ASG, created_at: "2026-10-01T09:00:00Z" }),
    row({ id: CHANGED, type: "technical_assignment_changed", technical_staff_assignment_id: ASG, created_at: "2026-10-02T09:00:00Z" }),
    row({ id: CANCELLED_NOTE, type: "technical_assignment_cancelled", technical_staff_assignment_id: GONE, created_at: "2026-10-03T09:00:00Z" }),
    row({ id: ORDINARY, created_at: "2026-09-30T09:00:00Z" }),
    row({ id: OTHERS, user_id: "user-2", type: "technical_assignment_assigned", technical_staff_assignment_id: ASG }),
  ]);
  r.states.set(ASG, { acknowledgedAt: null, cancelledAt: null, changedAt: "2026-10-02T09:00:00Z" });
  r.states.set(GONE, { acknowledgedAt: null, cancelledAt: "2026-10-03T09:00:00Z", changedAt: "2026-09-01T09:00:00Z" });
  return r;
}

beforeAll(async () => {
  repo = freshRepo();
  ({ baseUrl, stop } = await serve(new Proxy({} as FakeRepo, { get: (_t, p) => (repo as never)[p as never] }), new FakeAccess()));
});
afterAll(() => stop());
beforeEach(() => {
  repo = freshRepo();
});

const list = async () => (await (await fetch(`${baseUrl}/notifications`, { headers: { cookie: COOKIE } })).json()).items as Array<{
  id: string;
  acknowledgement?: { canAcknowledge: boolean; acknowledgedAt: string | null };
}>;
const item = async (id: string) => (await list()).find((i) => i.id === id)!;
const acknowledge = (id: string, cookie = COOKIE) => fetch(`${baseUrl}/notifications/${id}/acknowledge`, { method: "POST", headers: { cookie } });

// end of test setup

describe("SCRUM-20/AC4 what a notification says about acknowledging (20-S11)", () => {
  it("20-S11: the notification about the current details can be acknowledged", async () => {
    expect((await item(CHANGED)).acknowledgement).toEqual({ canAcknowledge: true, acknowledgedAt: null });
  });

  it("20-S9: one sent before a later change is out of date, so it cannot", async () => {
    expect((await item(ASSIGNED)).acknowledgement).toEqual({ canAcknowledge: false, acknowledgedAt: null });
  });

  it("20-S11: once acknowledged, it says when instead", async () => {
    repo.states.get(ASG)!.acknowledgedAt = "2026-10-02T10:00:00Z";

    expect((await item(CHANGED)).acknowledgement).toEqual({ canAcknowledge: false, acknowledgedAt: "2026-10-02T10:00:00Z" });
  });

  it("20-S9: an assignment that was cancelled, or that the technician can no longer read, cannot be acknowledged", async () => {
    repo.states.get(ASG)!.cancelledAt = "2026-10-04T09:00:00Z";
    expect((await item(CHANGED)).acknowledgement).toEqual({ canAcknowledge: false, acknowledgedAt: null });
    repo.states.clear();
    expect((await item(CHANGED)).acknowledgement).toEqual({ canAcknowledge: false, acknowledgedAt: null });
  });

  it("20-S11: a 'cancelled' notification and ordinary notifications have nothing to acknowledge", async () => {
    expect((await item(CANCELLED_NOTE)).acknowledgement).toBeUndefined();
    expect((await item(ORDINARY)).acknowledgement).toBeUndefined();
  });

  it("20-S11: each assignment is looked up once for the whole list, and only for notifications that can be acknowledged", async () => {
    await list();
    // ASG has two notifications; GONE has only a "cancelled" one, which has nothing to acknowledge
    expect(repo.stateLookups).toEqual([[ASG]]);
  });

  it("20-S11: a list with no assignment notifications looks nothing up", async () => {
    repo.rows = repo.rows.filter((r) => !r.technical_staff_assignment_id);
    await list();
    expect(repo.stateLookups).toEqual([]);
  });
});

describe("SCRUM-20/AC4, AC5 POST /notifications/:id/acknowledge (20-S8, 20-S9)", () => {
  it("20-S8: acknowledges, and answers with the notification read and acknowledged", async () => {
    const res = await acknowledge(CHANGED);

    expect(res.status).toBe(200);
    expect(repo.acknowledged).toEqual([CHANGED]);
    const body = await res.json();
    expect(body).toMatchObject({ id: CHANGED, isRead: true, acknowledgement: { canAcknowledge: false, acknowledgedAt: "2026-10-16T02:00:00Z" } });
  });

  it("20-S9: someone else's or an unknown notification is 404, and nothing is acknowledged", async () => {
    expect((await acknowledge(OTHERS)).status).toBe(404);
    expect((await acknowledge("00000000-0000-4000-8000-0000000000ff")).status).toBe(404);
    expect(repo.acknowledged).toEqual([]);
  });

  it("20-S9: the database's refusals come back as clear answers", async () => {
    const cases: [string, number, string][] = [
      ["P0002", 404, "NOT_FOUND"],
      ["22023", 409, "NOT_ACKNOWLEDGEABLE"],
      ["CS020", 409, "ASSIGNMENT_CANCELLED"],
      ["CS021", 409, "OUT_OF_DATE"],
    ];
    for (const [code, status, apiCode] of cases) {
      repo.ackRefusal = code;
      const res = await acknowledge(CHANGED);
      expect([res.status, (await res.json()).code]).toEqual([status, apiCode]);
    }
  });

  it("20-S9: a notification that disappears while it is acknowledged (its event deleted) is 404", async () => {
    repo.acknowledge = async (id: string) => {
      repo.rows = repo.rows.filter((r) => r.id !== id);
    };

    expect((await acknowledge(CHANGED)).status).toBe(404);
  });

  it("20-S9: an unexpected database error is a plain 500; a malformed id is 422; no session is 401", async () => {
    repo.ackRefusal = "XX000";
    expect((await acknowledge(CHANGED)).status).toBe(500);
    expect((await acknowledge("not-a-uuid")).status).toBe(422);
    expect((await fetch(`${baseUrl}/notifications/${CHANGED}/acknowledge`, { method: "POST" })).status).toBe(401);
  });
});
