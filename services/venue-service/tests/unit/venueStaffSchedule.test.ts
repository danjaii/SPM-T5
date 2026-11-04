import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

// Wednesday 4 Nov 2026, 10:00 Singapore time: the current week is Mon 2 Nov to Sun 8 Nov.
const NOW = new Date("2026-11-04T02:00:00Z");
const slot = (day: number, hour: number) => ({ start: new Date(Date.UTC(2026, 10, day, hour)), end: new Date(Date.UTC(2026, 10, day, hour + 2)) });

function setup() {
  const bookings = new FakeBookingRepository();
  const venues = new FakeVenueReader([aVenue(), aVenue({ id: "venue-2", name: "Lotus Room", setupMinutes: 30, turnaroundMinutes: 45 })]);
  const roles = new FakeRoleReader({ "staff-1": "venue_staff", "coordinator-1": "event_coordinator" });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events: new FakeEventReader([]), venues, roles, users: new FakeUserReader({}) }) });
  const get = (path: string, user = "staff-1") => request(app).get(path).set("Cookie", `cs_session=tok-${user}`);
  return { bookings, get };
}

describe("SCRUM-163/AC1 the schedule behind the Venue Staff dashboard", () => {
  it("lists this week's approved bookings with venue name, Singapore times and the venue's setup and turnaround, earliest first", async () => {
    const { bookings, get } = setup();
    bookings.seed({ id: "late", eventId: "e2", venueId: "venue-1", ...slot(5, 6), status: "approved" });
    bookings.seed({ id: "early", eventId: "e1", venueId: "venue-2", ...slot(4, 1), status: "approved" });
    const res = await get("/booking-queue/schedule");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.map((b: { id: string }) => b.id)).toEqual(["early", "late"]);
    expect(res.body[0]).toMatchObject({ venueName: "Lotus Room", date: "2026-11-04", startTime: "09:00", endTime: "11:00", setupMinutes: 30, turnaroundMinutes: 45 });
  });

  it("leaves out pending, rejected and cancelled requests and bookings outside the week", async () => {
    const { bookings, get } = setup();
    bookings.seed({ id: "pending", eventId: "e1", venueId: "venue-1", ...slot(4, 1) });
    bookings.seed({ id: "rejected", eventId: "e2", venueId: "venue-1", ...slot(4, 3), status: "rejected" });
    bookings.seed({ id: "cancelled", eventId: "e3", venueId: "venue-1", ...slot(4, 5), status: "cancelled" });
    bookings.seed({ id: "next-week", eventId: "e4", venueId: "venue-1", ...slot(10, 1), status: "approved" });
    expect((await get("/booking-queue/schedule")).body).toEqual([]);
  });

  it("takes an explicit range, and refuses a bad one", async () => {
    const { bookings, get } = setup();
    bookings.seed({ id: "next-week", eventId: "e4", venueId: "venue-1", ...slot(10, 1), status: "approved" });
    expect((await get("/booking-queue/schedule?from=2026-11-09&to=2026-11-15")).body.map((b: { id: string }) => b.id)).toEqual(["next-week"]);
    expect((await get("/booking-queue/schedule?from=nonsense")).status).toBe(422);
  });

  it("is for Venue Staff only", async () => {
    const { get } = setup();
    expect((await get("/booking-queue/schedule", "coordinator-1")).status).toBe(403);
  });
});
