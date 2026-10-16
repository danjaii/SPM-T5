import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeVenueDetailsReader, aVenueWithDetails } from "../support/fakeVenueDetails";
import { FakeRoleReader, FakeVenueReader } from "../support/fakeVenueAndRoles";

// SCRUM-109 (docs/specs/venue-suitability.md): GET /venue-suitability, with the data layer faked.

const NOW = new Date("2026-10-01T00:00:00.000Z");

const deps = {
  anon: {
    auth: {
      getUser: async (t: string) => ({ data: { user: t.startsWith("tok-") ? { id: t.slice(4) } : null } }),
    },
  },
  forUser: () => {
    throw new Error("ports are faked");
  },
} as unknown as SupabaseDeps;

// TechConf 2026: 120 attendees, Theatre, 14 Nov 2030 09:00-17:00 (the shared test data, moved to a future date).
const techConf = anEvent({ id: "event-1", name: "TechConf 2026", expectedAttendance: 120, venueRequirements: "Theatre" });

function setup(options: { event?: ReturnType<typeof anEvent>; venues?: ReturnType<typeof aVenueWithDetails>[] } = {}) {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([options.event ?? techConf]);
  const venueDetails = new FakeVenueDetailsReader(
    options.venues ?? [aVenueWithDetails(), aVenueWithDetails({ id: "venue-2", name: "Lotus Room", maxCapacity: 60, layouts: [{ id: "l", name: "Boardroom", maxCapacity: 20 }] })],
  );
  const roles = new FakeRoleReader({
    "coordinator-1": "event_coordinator",
    "coordinator-2": "event_coordinator",
    "organiser-1": "event_organiser",
    "staff-1": "venue_staff",
    "attendee-1": "attendee",
  });
  const app = createApp(deps, {
    now: () => NOW,
    ports: () => ({ bookings, events, venues: new FakeVenueReader(), roles, users: new FakeUserReader(), venueDetails }),
  });
  const as = (userId: string) => (qs: string) => request(app).get(`/venue-suitability?${qs}`).set("Cookie", `cs_session=tok-${userId}`);
  return { app, bookings, events, coordinator: as("coordinator-1"), as };
}

const criterion = (body: { criteria: { key: string }[] }, key: string) =>
  body.criteria.find((c) => c.key === key) as { key: string; status: string; message: string };

describe("SCRUM-109/AC1 a venue that meets every requirement (109-S1)", () => {
  it("109-S1: Orchid Hall is Suitable for TechConf 2026 and the stated requirements are met", async () => {
    const { coordinator } = setup();
    const res = await coordinator("venueId=venue-1&eventId=event-1");
    expect(res.status).toBe(200);
    expect(res.body.overall).toBe("suitable");
    expect(res.body.venue).toMatchObject({ id: "venue-1", name: "Orchid Hall" });
    expect(res.body.event).toMatchObject({ id: "event-1", name: "TechConf 2026" });
    for (const key of ["capacity", "layout", "operatingHours", "availability"]) {
      expect(criterion(res.body, key).status).toBe("met");
    }
    expect(criterion(res.body, "facilities").status).toBe("not_checked");
  });
});

describe("SCRUM-109/AC2 not enough capacity (109-S2)", () => {
  it("109-S2: Lotus Room (60) is Not suitable for 120 attendees", async () => {
    const { coordinator } = setup({ event: { ...techConf, venueRequirements: null } });
    const res = await coordinator("venueId=venue-2&eventId=event-1");
    expect(res.status).toBe(200);
    expect(res.body.overall).toBe("not_suitable");
    expect(criterion(res.body, "capacity")).toMatchObject({
      status: "not_met",
      message: "Expected attendance 120 exceeds capacity 60",
    });
  });
});

describe("SCRUM-109/AC3 several requirements not met are all listed (109-S3)", () => {
  it("109-S3: capacity and layout are both listed as not met", async () => {
    const { coordinator } = setup();
    const res = await coordinator("venueId=venue-2&eventId=event-1");
    expect(criterion(res.body, "capacity").status).toBe("not_met");
    expect(criterion(res.body, "layout")).toMatchObject({ status: "not_met", message: "Theatre not supported" });
    expect(criterion(res.body, "facilities").status).toBe("not_checked");
  });
});

describe("SCRUM-109/AC4 the venue is not available (109-S4)", () => {
  it("109-S4: an overlapping booking for another event makes availability not met", async () => {
    const { coordinator, bookings } = setup();
    bookings.seed({
      eventId: "other-event",
      venueId: "venue-1",
      status: "approved",
      start: new Date("2030-11-14T05:00:00.000Z"),
      end: new Date("2030-11-14T10:00:00.000Z"),
    });
    const res = await coordinator("venueId=venue-1&eventId=event-1");
    expect(res.body.overall).toBe("not_suitable");
    expect(criterion(res.body, "availability").status).toBe("not_met");
  });

  it("109-S4: a booking that only touches the end of the event is not a clash", async () => {
    const { coordinator, bookings } = setup();
    bookings.seed({
      eventId: "other-event",
      venueId: "venue-1",
      status: "approved",
      start: new Date("2030-11-14T09:00:00.000Z"),
      end: new Date("2030-11-14T12:00:00.000Z"),
    });
    const res = await coordinator("venueId=venue-1&eventId=event-1");
    expect(criterion(res.body, "availability").status).toBe("met");
  });

  it("109-S4: a rejected booking does not hold the venue", async () => {
    const { coordinator, bookings } = setup();
    bookings.seed({
      eventId: "other-event",
      venueId: "venue-1",
      status: "rejected",
      start: new Date("2030-11-14T01:00:00.000Z"),
      end: new Date("2030-11-14T09:00:00.000Z"),
    });
    expect(criterion((await coordinator("venueId=venue-1&eventId=event-1")).body, "availability").status).toBe("met");
  });
});

describe("SCRUM-109/AC5 outside operating hours (109-S5)", () => {
  it("109-S5: an event starting at 07:00 is outside Orchid Hall's 08:00 opening", async () => {
    const { coordinator } = setup({ event: { ...techConf, proposedStart: new Date("2030-11-13T23:00:00.000Z") } });
    const res = await coordinator("venueId=venue-1&eventId=event-1");
    expect(criterion(res.body, "operatingHours").status).toBe("not_met");
    expect(res.body.overall).toBe("not_suitable");
  });
});

describe("SCRUM-109/AC6 requirements not given are not checked (109-S6)", () => {
  it("109-S6: no layout preference, with a free-text note under Check manually", async () => {
    const { coordinator } = setup({
      event: { ...techConf, venueRequirements: null, accessibilityNeeds: "Stage must face the windows" },
    });
    const res = await coordinator("venueId=venue-1&eventId=event-1");
    expect(res.body.overall).toBe("suitable");
    expect(criterion(res.body, "layout")).toMatchObject({ status: "not_checked", message: "Not specified – not checked" });
    expect(res.body.manualChecks).toEqual(["Stage must face the windows"]);
  });

  it("109-S6: an event with no period set has hours and availability not checked", async () => {
    const { coordinator } = setup({ event: { ...techConf, proposedStart: null, proposedEnd: null } });
    const res = await coordinator("venueId=venue-1&eventId=event-1");
    expect(criterion(res.body, "operatingHours").status).toBe("not_checked");
    expect(criterion(res.body, "availability").status).toBe("not_checked");
  });
});

describe("SCRUM-109/AC7 who can run the check (109-S7)", () => {
  const url = "venueId=venue-1&eventId=event-1";

  it("109-S7: 401 without a session", async () => {
    const { app } = setup();
    expect((await request(app).get(`/venue-suitability?${url}`)).status).toBe(401);
  });

  it.each(["organiser-1", "attendee-1"])("109-S7: %s gets 403", async (user) => {
    const { as } = setup();
    expect((await as(user)(url)).status).toBe(403);
  });

  it("109-S7: the 403 comes before validation, so it reveals nothing", async () => {
    const { as } = setup();
    expect((await as("organiser-1")("")).status).toBe(403);
  });

  it("109-S7: a coordinator and venue staff both get 200", async () => {
    const { as } = setup();
    expect((await as("coordinator-1")(url)).status).toBe(200);
    expect((await as("staff-1")(url)).status).toBe(200);
  });

  it("109-S7: a coordinator cannot check an event assigned to someone else", async () => {
    const { as } = setup();
    expect((await as("coordinator-2")(url)).status).toBe(403);
  });
});

describe("SCRUM-109 inputs and overrides (109-S8, 109-S9)", () => {
  it("109-S9: an unknown venue or event is 404", async () => {
    const { coordinator } = setup();
    expect((await coordinator("venueId=nope&eventId=event-1")).status).toBe(404);
    expect((await coordinator("venueId=venue-1&eventId=nope")).status).toBe(404);
  });

  it("109-S9: an inactive-looking missing venue never leaks, missing ids are 422 with a message per field", async () => {
    const { coordinator } = setup();
    const res = await coordinator("");
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toMatchObject({ venueId: expect.any(String), eventId: expect.any(String) });
  });

  it("109-S9: a malformed time or attendance is 422", async () => {
    const { coordinator } = setup();
    const res = await coordinator("venueId=venue-1&eventId=event-1&date=2030-11-14&startTime=9am&endTime=12:00&attendance=abc");
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toHaveProperty("startTime");
    expect(res.body.fieldErrors).toHaveProperty("attendance");
  });

  it("109-S9: a date without its times is 422", async () => {
    const { coordinator } = setup();
    const res = await coordinator("venueId=venue-1&eventId=event-1&date=2030-11-14");
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toHaveProperty("startTime");
  });

  it("109-S9: the typed date and times replace the event's", async () => {
    const { coordinator } = setup();
    const res = await coordinator("venueId=venue-1&eventId=event-1&date=2030-11-14&startTime=06:00&endTime=09:00");
    expect(criterion(res.body, "operatingHours").status).toBe("not_met");
  });

  it("109-S11: skipAvailability leaves availability unchecked, so a request does not clash with itself", async () => {
    const { coordinator, bookings } = setup();
    bookings.seed({
      eventId: "event-1",
      venueId: "venue-1",
      status: "requested",
      start: new Date("2030-11-14T01:00:00.000Z"),
      end: new Date("2030-11-14T09:00:00.000Z"),
    });
    const res = await coordinator("venueId=venue-1&eventId=event-1&skipAvailability=true");
    expect(criterion(res.body, "availability").status).toBe("not_checked");
    expect(res.body.overall).toBe("suitable");
  });

  it("110-S6: a booking's own layout (venueRequirements) replaces the event's", async () => {
    const { coordinator } = setup({ event: { ...techConf, expectedAttendance: 15 } });
    const own = await coordinator("venueId=venue-2&eventId=event-1&venueRequirements=Boardroom");
    expect(criterion(own.body, "layout").status).toBe("met");
    expect(criterion(own.body, "capacity").status).toBe("met");
    const theatre = await coordinator("venueId=venue-2&eventId=event-1");
    expect(criterion(theatre.body, "layout")).toMatchObject({ status: "not_met", message: "Theatre not supported" });
  });

  it("109-S8: an explicit attendance replaces the event's", async () => {
    const { coordinator } = setup({ event: { ...techConf, venueRequirements: null } });
    const res = await coordinator("venueId=venue-2&eventId=event-1&attendance=40");
    expect(criterion(res.body, "capacity").status).toBe("met");
  });
});
