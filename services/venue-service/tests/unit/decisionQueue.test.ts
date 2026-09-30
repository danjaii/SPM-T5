import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

const NOW = new Date("2026-10-05T03:00:00.000Z");
const SLOT = { start: new Date("2030-11-14T01:00:00Z"), end: new Date("2030-11-14T09:00:00Z") };

const deps = {
  anon: { auth: { getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }) } },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

// Decisions (SCRUM-38) and the queue (SCRUM-37) mounted together, over HTTP.
function setup() {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([anEvent()]);
  const venues = new FakeVenueReader([aVenue()]);
  const roles = new FakeRoleReader({ "staff-1": "venue_staff", "coordinator-1": "event_coordinator" });
  const users = new FakeUserReader({ "coordinator-1": "Casey Coordinator" });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles, users }) });
  const cookie = "cs_session=tok-staff-1";
  const queue = async () => (await request(app).get("/booking-queue").set("Cookie", cookie)).body as { id: string }[];
  const post = (path: string, body?: object) => request(app).post(path).set("Cookie", cookie).send(body ?? {});
  const pending = () => bookings.seed({ eventId: "event-1", venueId: "venue-1", ...SLOT, requestedBy: "coordinator-1" });
  return { queue, post, pending };
}

describe("SCRUM-38/AC1 an approved request leaves the pending queue", () => {
  it("38-S1 an approved request no longer appears in GET /booking-queue", async () => {
    const { queue, post, pending } = setup();
    const row = pending();
    expect((await queue()).map((r) => r.id)).toEqual([row.id]);

    expect((await post(`/venue-bookings/${row.id}/approve`)).status).toBe(200);
    expect(await queue()).toEqual([]);
  });
});
