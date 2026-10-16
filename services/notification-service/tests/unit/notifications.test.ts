import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COOKIE, FakeAccess, FakeRepo, row, serve } from "../support/fakes";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";
const OTHERS = "00000000-0000-4000-8000-0000000000d1";
const EVENT = "11111111-1111-4111-8111-111111111111";
const BOOKING = "22222222-2222-4222-8222-222222222222";

const repo = new FakeRepo([
  row({ id: A, created_at: "2026-10-01T09:00:00Z", is_read: true, read_at: "2026-10-01T10:00:00Z", event_id: EVENT }),
  row({ id: B, created_at: "2026-10-03T09:00:00Z", title: "Newest" }),
  row({
    id: C,
    created_at: "2026-10-02T09:00:00Z",
    type: "venue_booking_flagged",
    venue_booking_id: BOOKING,
    event_id: EVENT,
  }),
  row({ id: OTHERS, user_id: "user-2", title: "Not for user-1" }),
]);
const access = new FakeAccess({
  [`event:${EVENT}`]: "Tech Summit",
  [`venue_booking:${BOOKING}`]: "Orchid Hall for Tech Summit",
});

let baseUrl: string;
let stop: () => Promise<unknown>;
beforeAll(async () => {
  ({ baseUrl, stop } = await serve(repo, access));
});
afterAll(() => stop());

const get = (path: string, cookie: string | null = COOKIE) =>
  fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : {} });
const post = (path: string, cookie: string | null = COOKIE) =>
  fetch(`${baseUrl}${path}`, { method: "POST", headers: cookie ? { cookie } : {} });

describe("SCRUM-46/AC1 view notifications (46-S1)", () => {
  it("46-S1: returns the caller's notifications newest first, with the unread count", async () => {
    const res = await get("/notifications");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([B, C, A]);
    expect(body.unreadCount).toBe(2);
  });

  it("46-S1: limit defaults to 50 and is capped at 100", async () => {
    repo.queries.length = 0;
    await get("/notifications");
    await get("/notifications?limit=500");
    await get("/notifications?limit=2");
    expect(repo.queries.map((q) => q.limit)).toEqual([50, 100, 2]);
  });

  it("46-S1: GET /notifications/unread-count answers with just the count (not read as an id)", async () => {
    const res = await get("/notifications/unread-count");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ unreadCount: 2 });
  });

  it("46-S1: 401 without a session, and with one Supabase does not recognise", async () => {
    expect((await get("/notifications", null)).status).toBe(401);
    expect((await get("/notifications", "cs_session=stale")).status).toBe(401);
    expect((await get("/notifications/unread-count", null)).status).toBe(401);
    expect((await post(`/notifications/${A}/read`, null)).status).toBe(401);
  });

  it("46-S1: an empty list is fine", async () => {
    const empty = await serve(new FakeRepo([]), access);
    try {
      const res = await fetch(`${empty.baseUrl}/notifications`, { headers: { cookie: COOKIE } });
      expect(await res.json()).toEqual({ items: [], unreadCount: 0 });
    } finally {
      await empty.stop();
    }
  });
});

describe("SCRUM-46/AC2 notification details (46-S2)", () => {
  it("46-S2: each item has its description, time, read state and related item", async () => {
    const body = await (await get("/notifications")).json();
    const flagged = body.items.find((i: { id: string }) => i.id === C);
    expect(flagged).toEqual({
      id: C,
      type: "venue_booking_flagged",
      title: "Event request submitted",
      message: "Your request has been submitted.",
      isRead: false,
      createdAt: "2026-10-02T09:00:00Z",
      readAt: null,
      related: {
        kind: "venue_booking",
        id: BOOKING,
        label: "Orchid Hall for Tech Summit",
        href: "/venue-bookings/" + BOOKING,
      },
    });
    const read = body.items.find((i: { id: string }) => i.id === A);
    expect(read.isRead).toBe(true);
    expect(read.readAt).toBe("2026-10-01T10:00:00Z");
  });

  it("46-S2: a notification with no event or booking has no related item", async () => {
    const body = await (await get("/notifications")).json();
    expect(body.items.find((i: { id: string }) => i.id === B).related).toBeNull();
  });
});

describe("SCRUM-46/AC5 navigate from a notification (46-S5)", () => {
  it("46-S5: an event links to its page; a booking to the booking page, or the queue for venue staff", async () => {
    const body = await (await get("/notifications")).json();
    expect(body.items.find((i: { id: string }) => i.id === A).related).toEqual({
      kind: "event",
      id: EVENT,
      label: "Tech Summit",
      href: `/events/${EVENT}`,
    });

    const staff = await serve(repo, new FakeAccess({ [`venue_booking:${BOOKING}`]: "Orchid Hall" }, "venue_staff"));
    try {
      const res = await fetch(`${staff.baseUrl}/notifications`, { headers: { cookie: COOKIE } });
      const item = (await res.json()).items.find((i: { id: string }) => i.id === C);
      expect(item.related.href).toBe(`/booking-queue/${BOOKING}`);
    } finally {
      await staff.stop();
    }
  });
});

describe("SCRUM-46/AC6 access control (46-S6)", () => {
  it("46-S6: never returns another user's notification", async () => {
    const body = await (await get("/notifications")).json();
    expect(body.items.map((i: { id: string }) => i.id)).not.toContain(OTHERS);
    expect(repo.queries.every((q) => q.userId === "user-1")).toBe(true);
  });

  it("46-S6: marking someone else's notification read is 404 and changes nothing", async () => {
    const res = await post(`/notifications/${OTHERS}/read`);
    expect(res.status).toBe(404);
    expect(repo.rows.find((r) => r.id === OTHERS)?.is_read).toBe(false);
  });

  it("46-S6: a missing notification is 404 too", async () => {
    expect((await post(`/notifications/00000000-0000-4000-8000-0000000000ff/read`)).status).toBe(404);
  });
});

describe("SCRUM-46/AC7 restricted destination (46-S7)", () => {
  it("46-S7: a target the caller can no longer see gets no link and the no-access wording", async () => {
    const restricted = await serve(repo, new FakeAccess({}));
    try {
      const res = await fetch(`${restricted.baseUrl}/notifications`, { headers: { cookie: COOKIE } });
      const body = await res.json();
      const flagged = body.items.find((i: { id: string }) => i.id === C);
      expect(flagged.related).toEqual({
        kind: "venue_booking",
        id: BOOKING,
        label: "You no longer have access to this item",
        href: null,
      });
      expect(JSON.stringify(body)).not.toContain("Orchid Hall");
      expect(JSON.stringify(body)).not.toContain("Tech Summit");
    } finally {
      await restricted.stop();
    }
  });
});

describe("SCRUM-46/AC4 mark a notification read (46-S4)", () => {
  it("46-S4: marks it read, and the unread count drops", async () => {
    const before = (await (await get("/notifications/unread-count")).json()).unreadCount;
    const res = await post(`/notifications/${B}/read`);
    expect(res.status).toBe(200);
    const item = await res.json();
    expect(item.isRead).toBe(true);
    expect(item.readAt).not.toBeNull();
    expect((await (await get("/notifications/unread-count")).json()).unreadCount).toBe(before - 1);
  });

  it("46-S4: is idempotent: reading a read notification keeps its first read time", async () => {
    const first = await (await post(`/notifications/${B}/read`)).json();
    const second = await (await post(`/notifications/${B}/read`)).json();
    expect(second.isRead).toBe(true);
    expect(second.readAt).toBe(first.readAt);
  });

  it("46-S4: 422 for an id that is not a uuid", async () => {
    const res = await post("/notifications/not-a-uuid/read");
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("VALIDATION_FAILED");
  });
});
