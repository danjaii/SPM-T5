import { EQUIPMENT_REQUEST_MESSAGES } from "@spm-t5/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { EquipmentInfo } from "../../src/readers/equipmentReader";
import type { EquipmentRequestInfo } from "../../src/readers/equipmentRequestReader";
import type { EventInfo } from "../../src/readers/eventReader";
import type { VenueBookingInfo } from "../../src/readers/venueBookingReader";
import {
  FakeEquipmentReader,
  FakeEquipmentRequestReader,
  FakeEquipmentRequestWriter,
  FakeEventReader,
  FakeReservationReader,
  FakeReservationWriter,
  FakeVenueBookingReader,
  aVenueBooking,
  anEquipment,
  anEquipmentRequest,
  anEvent,
  fakeDeps,
  fakeRoles,
} from "../support/fakes";

// ----------------------------------------------------------------------------
// Test setup: the app with fake data. coord-1 is the event's assigned coordinator (see fakes.ts).
// ----------------------------------------------------------------------------

const EVENT = "evt-devops";
const mic = anEquipment({ id: "eq-mic", name: "Wireless Microphone Set", type: "Audio" });
const projector = anEquipment();

function setup({
  events = [anEvent()],
  equipment = [projector, mic],
  bookings = [aVenueBooking()],
  stored = [] as EquipmentRequestInfo[],
}: { events?: EventInfo[]; equipment?: EquipmentInfo[]; bookings?: VenueBookingInfo[]; stored?: EquipmentRequestInfo[] } = {}) {
  const writer = new FakeEquipmentRequestWriter();
  const app = createApp(fakeDeps, {
    ports: () => ({
      events: new FakeEventReader(events),
      equipment: new FakeEquipmentReader(equipment),
      reservations: new FakeReservationReader(),
      roles: fakeRoles(),
      writer: new FakeReservationWriter(),
      venueBookings: new FakeVenueBookingReader(bookings),
      requests: new FakeEquipmentRequestReader(stored),
      requestWriter: writer,
    }),
  });
  const as = (user: string | null, req: request.Test) => (user ? req.set("Cookie", `cs_session=tok-${user}`) : req);
  return {
    writer,
    form: (user: string | null = "coord-1", eventId = EVENT) => as(user, request(app).get(`/events/${eventId}/equipment-request-form`)),
    list: (user: string | null = "coord-1", eventId = EVENT) => as(user, request(app).get(`/events/${eventId}/equipment-requests`)),
    submit: (body: Record<string, unknown>, user: string | null = "coord-1", eventId = EVENT) =>
      as(user, request(app).post(`/events/${eventId}/equipment-requests`).send(body)),
  };
}

/** A complete request; each test changes only the field it is about. */
const valid = { equipmentId: "eq-mic", quantity: "4", venueBookingId: "vb-hall", notes: "Two on stage" };

// end of test setup

describe("SCRUM-86/AC1 create a request", () => {
  it("saves it as Submitted, made by the signed-in coordinator, for the booked period", async () => {
    const { submit, writer } = setup();
    const res = await submit(valid);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: "req-new-1",
      equipment: "Audio: Wireless Microphone Set",
      quantity: 4,
      venueName: "Grand Hall",
      venueBookingId: "vb-hall",
      notes: "Two on stage",
      status: "SUBMITTED",
      statusLabel: "Submitted",
      releasedReason: null, // SCRUM-102: only a Released one has a reason
    });
    expect(writer.saved).toEqual([
      {
        eventId: EVENT,
        equipmentId: "eq-mic",
        quantity: 4,
        venueBookingId: "vb-hall",
        notes: "Two on stage",
        start: new Date("2026-10-15T01:00:00Z"),
        end: new Date("2026-10-15T09:00:00Z"),
        requestedBy: "coord-1",
      },
    ]);
  });

  it("technical notes are optional", async () => {
    const { submit, writer } = setup();
    const res = await submit({ ...valid, notes: "" });
    expect(res.status).toBe(201);
    expect(writer.saved[0].notes).toBeNull();
  });

  it("the form lists the items by type, without retired ones, and the event's approved venues", async () => {
    const retired = anEquipment({ id: "eq-old", name: "Old Projector", operationalStatus: "retired" });
    const damaged = anEquipment({ id: "eq-cable", name: "Extension Cable", type: null, operationalStatus: "damaged" });
    const { form } = setup({
      equipment: [projector, mic, retired, damaged],
      bookings: [
        aVenueBooking(),
        aVenueBooking({ id: "vb-pending", status: "requested", venueName: "Studio" }),
        aVenueBooking({ id: "vb-rejected", status: "rejected", venueName: "Annex" }),
      ],
    });
    const res = await form();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      event: { id: EVENT, name: "DevOps Summit" },
      equipment: [
        { id: "eq-mic", label: "Audio: Wireless Microphone Set" },
        { id: "eq-projector", label: "AV: Projector Unit" },
        { id: "eq-cable", label: "Extension Cable" },
      ],
      venues: [{ id: "vb-hall", venueName: "Grand Hall", date: "2026-10-15", startTime: "09:00", endTime: "17:00" }],
    });
  });

  it("an item that is not offered (unknown or retired) counts as none chosen, and nothing is saved", async () => {
    const retired = anEquipment({ id: "eq-old", operationalStatus: "retired" });
    const { submit, writer } = setup({ equipment: [mic, retired] });
    for (const equipmentId of ["eq-unknown", "eq-old"]) {
      const res = await submit({ ...valid, equipmentId });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ equipmentId: EQUIPMENT_REQUEST_MESSAGES.equipmentMissing });
    }
    expect(writer.saved).toEqual([]);
  });

  it("the venue must be one of the event's approved bookings, and nothing is saved otherwise", async () => {
    const { submit, writer } = setup({
      bookings: [aVenueBooking(), aVenueBooking({ id: "vb-pending", status: "requested" })],
    });
    for (const venueBookingId of ["vb-pending", "vb-other-event"]) {
      const res = await submit({ ...valid, venueBookingId });
      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ venueBookingId: EQUIPMENT_REQUEST_MESSAGES.venueMissing });
    }
    expect(writer.saved).toEqual([]);
  });
});

describe("SCRUM-86/AC2 see the request on the event", () => {
  it("shows each request's equipment, quantity, venue, notes and status", async () => {
    const { list } = setup({ stored: [anEquipmentRequest({ notes: "Near the stage" })] });
    const res = await list();

    expect(res.status).toBe(200);
    expect(res.body.requests).toEqual([
      {
        id: "req-1",
        equipment: "AV: Projector Unit",
        quantity: 2,
        venueName: "Grand Hall",
        venueBookingId: "vb-hall",
        notes: "Near the stage",
        status: "SUBMITTED",
        statusLabel: "Submitted",
        releasedReason: null, // SCRUM-102: only a Released one has a reason
      },
    ]);
  });

  it("rows made before requests named a venue show no venue", async () => {
    const { list } = setup({ stored: [anEquipmentRequest({ id: "old", venueName: null, status: "reserved" })] });
    const res = await list();
    expect(res.body.requests).toEqual([expect.objectContaining({ id: "old", venueName: null, status: "ARRANGED", statusLabel: "Arranged" })]);
  });

  // SCRUM-102/AC7 (102-S31): the coordinator cancelled the Grand Hall venue booking ("Moved to a bigger room"), which
  // released its 2 projectors; the list says so instead of hiding them (it used to leave cancelled rows out)
  it("102-S31 equipment released with its venue booking shows as Released, with the venue booking's cancellation reason", async () => {
    const { list } = setup({
      stored: [
        anEquipmentRequest({ id: "released", status: "cancelled", venueBookingCancellationReason: "Moved to a bigger room" }),
        anEquipmentRequest({ id: "still-needed", status: "approved" }),
      ],
    });
    const res = await list();

    expect(res.body.requests).toEqual([
      expect.objectContaining({ id: "released", venueName: "Grand Hall", status: "RELEASED", statusLabel: "Released", releasedReason: "Moved to a bigger room" }),
      expect.objectContaining({ id: "still-needed", status: "ARRANGED", releasedReason: null }),
    ]);
  });

  it("Technical Support Staff can see an event's requests too, but cannot add one", async () => {
    const { list } = setup({ stored: [anEquipmentRequest()] });
    const res = await list("tech-1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requests: [expect.objectContaining({ id: "req-1" })], canCreate: false });
  });

  it("an event that does not exist is a 404", async () => {
    const { list } = setup();
    expect((await list("coord-1", "evt-missing")).status).toBe(404);
  });
});

describe("SCRUM-86/AC3 several requests per event", () => {
  it("each request is listed with its own status", async () => {
    const { list } = setup({
      stored: [
        anEquipmentRequest({ id: "a", status: "requested" }),
        anEquipmentRequest({ id: "b", equipmentName: "Wireless Microphone Set", equipmentType: "Audio", status: "rejected" }),
      ],
    });
    const res = await list();
    expect(res.body.requests.map((r: { id: string; statusLabel: string }) => [r.id, r.statusLabel])).toEqual([
      ["a", "Submitted"],
      ["b", "Cannot Fulfil"],
    ]);
  });

  it("a request for a different item is saved alongside the first", async () => {
    const { submit, writer } = setup({ stored: [anEquipmentRequest()] });
    const res = await submit({ ...valid, equipmentId: "eq-mic" });
    expect(res.status).toBe(201);
    expect(writer.saved).toHaveLength(1);
  });
});

describe("SCRUM-86/AC4 missing information", () => {
  it.each([
    ["equipmentId", EQUIPMENT_REQUEST_MESSAGES.equipmentMissing],
    ["quantity", EQUIPMENT_REQUEST_MESSAGES.quantityMissing],
    ["venueBookingId", EQUIPMENT_REQUEST_MESSAGES.venueMissing],
  ])("an empty %s is refused with its message, and nothing is saved", async (field, message) => {
    const { submit, writer } = setup();
    const res = await submit({ ...valid, [field]: "" });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ code: "VALIDATION_FAILED", error: "Some fields are invalid.", fieldErrors: { [field]: message } });
    expect(writer.saved).toEqual([]);
  });

  it("every empty field is reported at once", async () => {
    const { submit } = setup();
    const res = await submit({});
    expect(Object.keys(res.body.fieldErrors).sort()).toEqual(["equipmentId", "quantity", "venueBookingId"]);
  });
});

describe("SCRUM-86/AC5 wrong quantity", () => {
  it.each(["0", "-1", "1.5", "abc"])("%s is refused with the spec's message, and nothing is saved", async (quantity) => {
    const { submit, writer } = setup();
    const res = await submit({ ...valid, quantity });
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({ quantity: "Quantity must be a whole number of 1 or more" });
    expect(writer.saved).toEqual([]);
  });
});

describe("SCRUM-86/AC6 finished events", () => {
  it.each(["completed", "cancelled", "rejected"])("a %s event: no form, nothing saved, and no add option", async (status) => {
    const { form, submit, list, writer } = setup({ events: [anEvent({ status })] });

    const formRes = await form();
    expect(formRes.status).toBe(409);
    expect(formRes.body).toEqual({ code: "EVENT_LOCKED", error: EQUIPMENT_REQUEST_MESSAGES.eventLocked });
    expect((await submit(valid)).status).toBe(409);
    expect(writer.saved).toEqual([]);
    expect((await list()).body.canCreate).toBe(false);
  });

  it("an open event: the assigned coordinator can add a request", async () => {
    const { list } = setup();
    expect((await list()).body.canCreate).toBe(true);
  });
});

describe("SCRUM-86/AC7 only the assigned coordinator", () => {
  it.each([
    ["another coordinator", "coord-2"],
    ["Technical Support Staff", "tech-1"],
    ["the organiser", "event_organiser-user"],
    ["venue staff", "venue_staff-user"],
    ["an attendee", "attendee-user"],
  ])("%s gets no form and cannot save a request", async (_who, user) => {
    const { form, submit, writer } = setup();
    expect((await form(user)).status).toBe(403);
    const res = await submit(valid, user);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: "FORBIDDEN", error: "You are not allowed to do that." });
    expect(writer.saved).toEqual([]);
  });

  it("another coordinator cannot see the event's requests", async () => {
    const { list } = setup({ stored: [anEquipmentRequest()] });
    expect((await list("coord-2")).status).toBe(403);
  });

  it("an event with no coordinator assigned: nobody can request for it", async () => {
    const { submit } = setup({ events: [anEvent({ assignedCoordinatorId: null })] });
    expect((await submit(valid)).status).toBe(403);
  });

  it("a coordinator asking about an event that does not exist gets a 404", async () => {
    const { form } = setup();
    expect((await form("coord-1", "evt-missing")).status).toBe(404);
  });

  it("someone not signed in is turned away", async () => {
    const { form, submit, list } = setup();
    expect((await form(null)).status).toBe(401);
    expect((await submit(valid, null)).status).toBe(401);
    expect((await list(null)).status).toBe(401);
  });
});

describe("SCRUM-116/AC3 a Safety Officer cannot edit the technical arrangements", () => {
  it("SCRUM-116/AC3 a Safety Officer's equipment request gets 403 and nothing is saved", async () => {
    const { submit, writer } = setup();
    const res = await submit(valid, "safety_officer-user");

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: "FORBIDDEN", error: "You are not allowed to do that." });
    expect(writer.saved).toEqual([]);
  });
});
