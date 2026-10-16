import request from "supertest";
import { describe, it, expect } from "vitest";
import { createApp } from "../../src/app";
import type { SupabaseDeps } from "../../src/supabase";
import { FakeBookingRepository } from "../support/fakeBookingRepository";
import { FakeEventReader, anEvent } from "../support/fakeEventReader";
import { FakeUserReader } from "../support/fakeUserReader";
import { FakeVenueDetailsReader } from "../support/fakeVenueDetails";
import { FakeRoleReader, FakeVenueReader, aVenue } from "../support/fakeVenueAndRoles";

// ----------------------------------------------------------------------------
// Test setup: event-1 (assigned to coordinator-1) already has two venue bookings on 14 Nov 2030
// (docs/specs/change-cancel-venue-booking.md)
// ----------------------------------------------------------------------------

const NOW = new Date("2026-10-01T00:00:00.000Z");

/** Token "tok-<userId>" belongs to that user; anything else is unknown. */
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

/** A period on 14 Nov 2030; `from` and `to` are UTC hours (Singapore is 8 hours ahead, so 1 is 9am). */
const on14Nov = (from: number, to: number) => ({
  start: new Date(Date.UTC(2030, 10, 14, from)),
  end: new Date(Date.UTC(2030, 10, 14, to)),
});

function setup() {
  const bookings = new FakeBookingRepository(() => NOW);
  const events = new FakeEventReader([anEvent()]);
  const venues = new FakeVenueReader([aVenue(), aVenue({ id: "venue-2", name: "Lotus Room" })]);
  const roles = new FakeRoleReader({
    "coordinator-1": "event_coordinator",
    "coordinator-2": "event_coordinator",
    "organiser-1": "event_organiser",
    "staff-1": "venue_staff",
    "tech-1": "technical_support_staff",
    "attendee-1": "attendee",
  });
  const app = createApp(deps, { now: () => NOW, ports: () => ({ bookings, events, venues, roles, users: new FakeUserReader(), venueDetails: FakeVenueDetailsReader.from(venues) }) });

  // Orchid Hall (venue-1) 9am-12pm and Lotus Room (venue-2) 9am-5pm, both waiting for venue staff
  const hall = bookings.seed({ eventId: "event-1", venueId: "venue-1", ...on14Nov(1, 4) });
  const room = bookings.seed({ eventId: "event-1", venueId: "venue-2", ...on14Nov(1, 9) });

  const change = (id: string, body: object, userId = "coordinator-1") =>
    request(app).patch(`/venue-bookings/${id}`).set("Cookie", `cs_session=tok-${userId}`).send(body);
  return { app, bookings, events, hall, room, change };
}

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-102/AC1 changing one venue booking checks only that one and leaves the others as they were
// ----------------------------------------------------------------------------

describe("SCRUM-102/AC1 change one venue booking (102-S1)", () => {
  // move Orchid Hall to the next day, 2pm to 6pm; the Lotus Room venue booking must not move
  // when we have 2 venue bookings, and we want to change orchid hall to the next day, we should get a 200 response because we want the change to be successful
  it("102-S1 changing the date and times of one of two venue bookings: 200, it has the new period and is PENDING, the other is unchanged", async () => {
    const { change, hall, room } = setup();
    const roomBefore = { ...room };

    const res = await change(hall.id, { date: "2030-11-15", startTime: "14:00", endTime: "18:00" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: hall.id, venueId: "venue-1", date: "2030-11-15", startTime: "14:00", endTime: "18:00", status: "PENDING" });
    expect(hall.start).toEqual(new Date("2030-11-15T06:00:00.000Z"));
    expect(hall.end).toEqual(new Date("2030-11-15T10:00:00.000Z"));
    expect(room).toEqual(roomBefore);
  });

  // Orchid Hall was already approved by venue staff; after the change they have to decide on it again
  // changing an approved venue booking makes it pending again 
  it("102-S2 changing an APPROVED venue booking makes it PENDING again, clears the earlier decision, and puts it back in the venue staff queue", async () => {
    const { change, bookings, hall } = setup();
    Object.assign(hall, { status: "approved", reviewedBy: "staff-1", reviewedAt: new Date("2026-09-20T00:00:00Z"), reviewNotes: "Fine" });

    const res = await change(hall.id, { date: "2030-11-15", startTime: "14:00", endTime: "18:00" });

    expect(res.status).toBe(200);
    expect(hall).toMatchObject({ status: "requested", reviewedBy: null, reviewedAt: null, reviewNotes: null });
    expect((await bookings.listPending()).map((b) => b.id)).toContain(hall.id);
  });

  // same date and times, only this venue booking's own numbers change
  // we only change the attendance and "banquet", so status changes from approved to pending 
  it("102-S3 changing only the expected attendance and the venue requirements stores them on that venue booking, PENDING again", async () => {
    const { change, hall } = setup();
    hall.status = "approved";

    const res = await change(hall.id, { date: "2030-11-14", startTime: "09:00", endTime: "12:00", expectedAttendance: 80, venueRequirements: "Banquet" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ expectedAttendance: 80, venueRequirements: "Banquet", status: "PENDING" });
    expect(hall.snapshot).toMatchObject({ expectedAttendance: 80, venueRequirements: "Banquet" });
  });

  // another event already holds Orchid Hall on 15 Nov from 2pm to 4pm
  // another event holds Orchid Hall on 15 nov from 2 to 4 pm. changing our orchid hall venue booking to 3 to 6pm that day must be refused with SLOT-CONFLICT and keep its own time 
  it("102-S4 changing to a period another event holds at that venue: 409 SLOT_CONFLICT, and the venue booking keeps its old period", async () => {
    const { change, bookings, hall } = setup();
    bookings.seed({ eventId: "other-event", venueId: "venue-1", start: new Date("2030-11-15T06:00:00Z"), end: new Date("2030-11-15T08:00:00Z") });
    const before = { start: hall.start, end: hall.end, status: hall.status };

    const res = await change(hall.id, { date: "2030-11-15", startTime: "15:00", endTime: "18:00" });

    expect(res.status).toBe(409);
    // we expect status number 409 to be returned 
    expect(res.body.code).toBe("SLOT_CONFLICT");
    expect(hall).toMatchObject(before);
  });

  // this event also holds Orchid Hall from 2pm to 5pm; moving the 9am booking to 1pm-3pm would overlap it
  // we have one event, which has orchird hall booked from 9am to 12pm. we want to move it to 1-3pm, which we want it to be rejected because this event is already booking orchird hall from 2-5pm also, so there shouldnt be overlapping times when we try to shift a venue booking time 
  it("102-S5 changing to a period that overlaps another of this event's venue bookings at the same venue: 409 DUPLICATE_VENUE", async () => {
    const { change, bookings, hall } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-1", ...on14Nov(6, 9) });

    const res = await change(hall.id, { date: "2030-11-14", startTime: "13:00", endTime: "15:00" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_VENUE");
    expect(hall.start).toEqual(on14Nov(1, 4).start);
  });
  // move from 9am to 12pm → 10-1pm, which is allowed 
  // 9am-12pm to 10am-1pm overlaps the venue booking's own current period, which must not count as a clash
  it("102-S6 changing to a period that overlaps its own current period is fine: 200", async () => {
    const { change, hall } = setup();

    const res = await change(hall.id, { date: "2030-11-14", startTime: "10:00", endTime: "13:00" });

    expect(res.status).toBe(200);
    expect(hall.start).toEqual(on14Nov(2, 5).start);
  });
  // change to 200 people for a venue that holds 150 people, exceedCapacity becomes True
  // Orchid Hall holds 150 people
  it("102-S7 changing to more people than the venue holds: 200, flagged exceedsCapacity (a warning, not a refusal)", async () => {
    const { change, hall } = setup();

    const res = await change(hall.id, { date: "2030-11-14", startTime: "09:00", endTime: "12:00", expectedAttendance: 200, overrideReason: "Overflow room arranged" });

    expect(res.status).toBe(200);
    expect(res.body.exceedsCapacity).toBe(true);
  });
  // if end time is before start time, or start time is past, or attendance is 0, we reject with status 422
  
  it.each([
    ["the end before the start", { date: "2030-11-15", startTime: "18:00", endTime: "14:00" }, "endTime"],
    ["a start in the past", { date: "2026-09-30", startTime: "09:00", endTime: "12:00" }, "startTime"],
    ["an attendance of 0", { date: "2030-11-15", startTime: "09:00", endTime: "12:00", expectedAttendance: 0 }, "expectedAttendance"],
  ])("102-S8 %s: 422 with a field error, and nothing changes", async (_name, body, field) => {
    const { change, hall } = setup();
    const before = { ...hall };

    const res = await change(hall.id, body);

    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toHaveProperty(field);
    expect(hall).toEqual(before);
  });
  // when we try to make a change to the venue booking by making no actual changes, we return status 409
  // the same date and times and no new numbers: sending it back to venue staff would be pointless
  it.each([
    ["the same period and nothing else", {}],
    ["the same period and the same attendance and requirements", { expectedAttendance: 10, venueRequirements: null }],
  ])("102-S9 %s: 409 NO_CHANGES, and an approved venue booking stays approved", async (_name, extra) => {
    const { change, hall } = setup();
    hall.status = "approved";

    const res = await change(hall.id, { date: "2030-11-14", startTime: "09:00", endTime: "12:00", ...extra });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "NO_CHANGES", error: "Nothing was changed." });
    expect(hall.status).toBe("approved");
  });
  // venue staff already rejected Orchid Hall on 15 Nov 2-6pm for this event. changing to the exact slot is refused with REPEAT_OF_REJECTED, returning a status of 409 
  // venue staff already rejected Orchid Hall on 15 Nov 2pm-6pm for this event (32-S7's rule)
  it("102-S10 changing to the exact slot of a rejected venue booking of this event at that venue: 409 REPEAT_OF_REJECTED", async () => {
    const { change, bookings, hall } = setup();
    bookings.seed({ eventId: "event-1", venueId: "venue-1", status: "rejected", start: new Date("2030-11-15T06:00:00Z"), end: new Date("2030-11-15T10:00:00Z") });

    const res = await change(hall.id, { date: "2030-11-15", startTime: "14:00", endTime: "18:00" });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REPEAT_OF_REJECTED");
  });

  // a rejected one is amended instead (SCRUM-60); a withdrawn or cancelled one is finished
  // if orchird hall's venue booking is rejected, withdrawn or cancelled, we wont allow them to make amendements. if they want, they can create a new venue booking request instead 
  it.each(["rejected", "withdrawn", "cancelled"])("102-S11 changing a %s venue booking: 409 NOT_ACTIVE, and nothing changes", async (status) => {
    const { change, hall } = setup();
    hall.status = status;
    const before = { ...hall };

    const res = await change(hall.id, { date: "2030-11-15", startTime: "14:00", endTime: "18:00" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "NOT_ACTIVE", error: "Only a pending or approved venue booking can be changed or cancelled." });
    expect(hall).toEqual(before);
  });
  // chaning a venue booking that does not exist return status 404
  // the status is checked before anything else about the change, so the reason given is the real one
  it("102-S11 a rejected venue booking sent with its same period is NOT_ACTIVE, not NO_CHANGES", async () => {
    const { change, hall } = setup();
    hall.status = "rejected";

    const res = await change(hall.id, { date: "2030-11-14", startTime: "09:00", endTime: "12:00" });

    expect(res.body.code).toBe("NOT_ACTIVE");
  });

  it("a venue booking that does not exist: 404", async () => {
    const res = await setup().change("nope", { date: "2030-11-15", startTime: "14:00", endTime: "18:00" });

    expect(res.status).toBe(404);
  });
});
// end of SCRUM-102/AC1

// ----------------------------------------------------------------------------
// SCRUM-102/AC6 only the event's current assigned coordinator, while the event can still have venues
// ----------------------------------------------------------------------------

describe("SCRUM-102/AC6 who may change a venue booking, and when (102-S21 to 102-S24)", () => {
  const newPeriod = { date: "2030-11-15", startTime: "14:00", endTime: "18:00" };
  // if the event coord is not assigned to the event, the person cannot change the venue booking, return status 403 
  it("102-S21 a coordinator the event is not assigned to cannot change its venue booking: 403, and nothing changes", async () => {
    const { change, hall } = setup();
    const before = { ...hall };

    const res = await change(hall.id, newPeriod, "coordinator-2");

    expect(res.status).toBe(403);
    expect(Object.keys(res.body).sort()).toEqual(["code", "error"]); // says nothing about the venue booking
    expect(hall).toEqual(before);
  });
  // return status 403 if the person trying to change the venue booking is an organiser, venue staff, technical support, an attendee, or a user with no role
  it.each(["organiser-1", "staff-1", "tech-1", "attendee-1", "ghost"])("102-S22 %s cannot change a venue booking: 403", async (userId) => {
    const { change, hall } = setup();

    expect((await change(hall.id, newPeriod, userId)).status).toBe(403);
    expect(hall.start).toEqual(on14Nov(1, 4).start);
  });
  // the role is checked first, so someone who may never change venue bookings learns nothing, not even whether one exists
  it("102-S22 venue staff changing a venue booking that does not exist: 403, not 404", async () => {
    expect((await setup().change("nope", newPeriod, "staff-1")).status).toBe(403);
  });

  // someone not signed in cannot change a venue booking: the venue service answers 401 (not signed in)
  it("102-S22 someone not signed in: 401", async () => {
    const { app, hall } = setup();

    expect((await request(app).patch(`/venue-bookings/${hall.id}`).send(newPeriod)).status).toBe(401);
  });

  // venue changes on a Confirmed event are a "material change" (SCRUM-111 to 113); closed or not-yet-approved events can't have venues
  it.each(["confirmed", "completed", "cancelled", "submitted"])("102-S23 the event is %s: 409 EVENT_NOT_ELIGIBLE, and nothing changes", async (status) => {
    const { change, events, hall } = setup();
    events.add(anEvent({ status }));

    const res = await change(hall.id, newPeriod);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVENT_NOT_ELIGIBLE");
    expect(hall.start).toEqual(on14Nov(1, 4).start);
  });

  //  if event is reassigned to coord 2 instead of coord 1, coord 2 now has the power to edit venue bookings
  // coord 1 then cannot make the venue booking edits
  // the Lead moved the event from coordinator-1 to coordinator-2 (SCRUM-79); Orchid Hall was requested by coordinator-1
  it("102-S24 the coordinator who took over the event can change a venue booking their predecessor made: 200", async () => {
    const { change, events, hall } = setup();
    hall.requestedBy = "coordinator-1";
    events.add(anEvent({ assignedCoordinatorId: "coordinator-2" }));

    const res = await change(hall.id, newPeriod, "coordinator-2");

    expect(res.status).toBe(200);
    expect(hall.start).toEqual(new Date("2030-11-15T06:00:00.000Z"));
  });

  // the other side of the same move: coordinator-1 made Orchid Hall's venue booking but no longer coordinates the event
  it("102-S21 the coordinator the event was moved away from cannot change the venue booking they made: 403, and nothing changes", async () => {
    const { change, events, hall } = setup();
    hall.requestedBy = "coordinator-1";
    events.add(anEvent({ assignedCoordinatorId: "coordinator-2" }));

    const res = await change(hall.id, newPeriod, "coordinator-1");

    expect(res.status).toBe(403);
    expect(hall.start).toEqual(on14Nov(1, 4).start);
  });
});
// end of SCRUM-102/AC6
