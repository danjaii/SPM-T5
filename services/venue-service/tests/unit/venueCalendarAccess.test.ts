import request from "supertest";
import { describe, expect, it } from "vitest";
import { sgtToUtc, type Role } from "@spm-t5/shared";
import { createApp } from "../../src/app";
import { aCalendarVenue, createFakeSession, FakeVenueCalendarReader } from "../support/fakeCalendar";

function arrange() {
  const reader = new FakeVenueCalendarReader([aCalendarVenue({ name: "Secret Hall" })]);
  reader.hold("orchid", "CONFIRMED", sgtToUtc("2026-11-11", "10:00"), sgtToUtc("2026-11-11", "12:00"));
  const session = createFakeSession();
  const app = createApp(session.deps, { now: () => sgtToUtc("2026-11-11", "09:00"), venueCalendar: () => reader });
  return { app, reader, signIn: session.signIn };
}

describe("SCRUM-84/AC8 access control", () => {
  it("S1: without a session the answer is 401 and nothing is read or shown", async () => {
    const { app, reader } = arrange();

    const res = await request(app).get("/venue-calendar");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ code: "UNAUTHENTICATED", error: "Not signed in." });
    expect(reader.reads).toBe(0);
  });

  it("S1: a session token the auth service does not know is 401 too", async () => {
    const { app, reader } = arrange();
    const res = await request(app).get("/venue-calendar").set("Cookie", "cs_session=forged");
    expect(res.status).toBe(401);
    expect(reader.reads).toBe(0);
  });

  it.each(["event_organiser", "attendee", "event_coordinator_lead", "safety_officer"] as Role[])("S2/S3: %s gets 403, no venue data, and nothing is read", async (role) => {
    const { app, reader, signIn } = arrange();

    const res = await request(app).get("/venue-calendar?from=2026-11-11").set("Cookie", signIn(role).cookie);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: "FORBIDDEN", error: "You are not allowed to view the venue calendar." });
    expect(JSON.stringify(res.body)).not.toMatch(/Secret Hall|venues|periods/);
    expect(reader.reads).toBe(0);
  });

  it("S2: the role is checked before the dates, so a refused role learns nothing from a 422", async () => {
    const { app, signIn } = arrange();
    const res = await request(app).get("/venue-calendar?from=2026-11-14&to=2026-11-13").set("Cookie", signIn("attendee").cookie);
    expect(res.status).toBe(403);
  });

  it("S2: a signed-in user with no profile row is refused", async () => {
    const { app, signIn } = arrange();
    const res = await request(app).get("/venue-calendar").set("Cookie", signIn("not-a-role" as Role).cookie);
    expect(res.status).toBe(403);
  });

  it.each(["event_coordinator", "venue_staff", "technical_support_staff"] as Role[])("S4: %s is let in", async (role) => {
    const { app, signIn } = arrange();
    const res = await request(app).get("/venue-calendar").set("Cookie", signIn(role).cookie);
    expect(res.status).toBe(200);
    expect(res.body.venues[0].name).toBe("Secret Hall");
  });
});
