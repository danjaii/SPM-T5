import { ROLES } from "@spm-t5/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { EquipmentInfo } from "../../src/readers/equipmentReader";
import type { EventInfo } from "../../src/readers/eventReader";
import type { ReservationInfo } from "../../src/readers/reservationReader";
import {
  FakeEquipmentReader,
  FakeEventReader,
  FakeReservationReader,
  FakeReservationWriter,
  anEquipment,
  anEvent,
  fakeDeps,
  fakeRoles,
} from "../support/fakes";

// ----------------------------------------------------------------------------
// Test setup: the app with fake data, and a helper to make a reservation.
// ----------------------------------------------------------------------------

// The clock: 2026-10-06 09:00 Singapore time.
const now = () => new Date("2026-10-06T01:00:00Z");

function setup(
  equipment: EquipmentInfo[] = [anEquipment()],
  writer = new FakeReservationWriter(),
  events: EventInfo[] = [anEvent()],
  // The reservations the availability check can see. Pass the same list to the writer, so what it saves shows up.
  stored: ReservationInfo[] = [],
) {
  const app = createApp(fakeDeps, {
    now,
    ports: () => ({
      events: new FakeEventReader(events),
      equipment: new FakeEquipmentReader(equipment),
      reservations: new FakeReservationReader(stored),
      roles: fakeRoles(),
      writer,
    }),
  });
  const reserve = (body: Record<string, unknown>, user: string | null = "tech-1") => {
    const req = request(app).post("/equipment-reservations").send(body);
    return user ? req.set("Cookie", `cs_session=tok-${user}`) : req;
  };
  // The SCRUM-18 availability check for the default period, as a Technical Support Staff member would run it.
  const check = (quantity = 1) =>
    request(app)
      .get("/equipment-availability")
      .query({ equipmentName: "Projector Unit", quantity: String(quantity), date: DATE, startTime: START_TIME, endTime: END_TIME })
      .set("Cookie", "cs_session=tok-tech-1");
  // GET /reservable-events: the events for the form's event dropdown.
  const listEvents = (user: string | null = "tech-1") => {
    const req = request(app).get("/reservable-events");
    return user ? req.set("Cookie", `cs_session=tok-${user}`) : req;
  };
  return { reserve, writer, check, listEvents };
}

// The reservation a Technical Support Staff member makes, filled in with ordinary values. Each test changes
// only the one field it is about.
const EVENT_ID = "evt-devops";
const EQUIPMENT_ID = "eq-projector";
const QUANTITY = 4;
const DATE = "2026-10-15";
const START_TIME = "09:00";
const END_TIME = "17:00";

/** The body of POST /equipment-reservations with the values above, except whatever a test changes. */
const body = (changes: Record<string, unknown> = {}) => ({
  eventId: EVENT_ID,
  equipmentId: EQUIPMENT_ID,
  quantity: QUANTITY,
  date: DATE,
  startTime: START_TIME,
  endTime: END_TIME,
  ...changes,
});

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-19 Reserve Equipment for an Event
// ----------------------------------------------------------------------------
describe("SCRUM-19 Reserve Equipment for an Event", () => {
  // AC1: Given that I have selected an equipment item from the equipment catalogue for a specific event, and
  // specified a quantity and a date and time period, when I make the reservation, the system should reserve that
  // quantity of the equipment for that event and period.
  describe("SCRUM-19/AC1 reserve the equipment for the event and period", () => {
    it("19-S1: reserving 4 Projector Units for an event saves that reservation, made by the staff member", async () => {
      const { reserve, writer } = setup();

      const res = await reserve(body());

      expect(res.status).toBe(201);
      // Exactly one reservation saved, for this event, equipment, quantity and period (Singapore 09:00-17:00).
      expect(writer.saved).toEqual([
        {
          eventId: "evt-devops",
          equipmentId: "eq-projector",
          quantity: 4,
          start: new Date("2026-10-15T01:00:00Z"),
          end: new Date("2026-10-15T09:00:00Z"),
          reservedBy: "tech-1",
        },
        // we want to reserve 4 projector units for the event "evt-devops"
        // return 201 if successful
      ]);
    });
  });
  // end of AC1

  // AC2: Given that the reservation has been successfully made, when the system confirms it, the system should
  // show me a confirmation of the reservation.
  describe("SCRUM-19/AC2 confirm the reservation", () => {
    it("19-S2: the reply confirms what was reserved, for when, and how many are still free", async () => {
      // The writer saves it as reservation "res-1" and reports 6 still free in that period.
      const { reserve } = setup([anEquipment()], new FakeReservationWriter({ ok: true, id: "res-1", availableAfter: 6 }));

      const res = await reserve(body());

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: "res-1",
        equipmentName: "Projector Unit",
        quantity: 4,
        date: "2026-10-15",
        startTime: "09:00",
        endTime: "17:00",
        availableAfter: 6,
      });
    });
    // we want the reply to be 201 with the reservation id, equipment name, quantity, date, start time, end time, and how many are still free
  });
  // end of AC2

  // AC6: Given that I have not selected an equipment item, when I attempt to make the reservation, the system
  // should prompt me to select the equipment.
  describe("SCRUM-19/AC6 equipment not selected", () => {
    it("19-S6: no equipment selected is refused with a prompt to select it, and nothing is saved", async () => {
      const { reserve, writer } = setup();

      const res = await reserve(body({ equipmentId: "" }));

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ equipmentId: "Please select the equipment." });
      expect(writer.saved).toEqual([]);
      // if equipmentId is not selected, return 422 with a prompt to select it, and nothing is saved
    });
  });
  // end of AC6

  // AC7: Given that I have not specified a quantity, when I attempt to make the reservation, the system should
  // prompt me to specify the quantity.
  describe("SCRUM-19/AC7 quantity not specified", () => {
    it("19-S7: no quantity is refused with a prompt to enter it, and nothing is saved", async () => {
      const { reserve, writer } = setup();

      const res = await reserve(body({ quantity: "" }));
      // we make quantity to be empty

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ quantity: "Please enter the quantity required." });
      expect(writer.saved).toEqual([]);
      // we expect the response to be 422
    });

    it.each([0, -2, 2.5, "abc"])("19-S7: a quantity of %s is refused, and nothing is saved", async (quantity) => {
      const { reserve, writer } = setup();
      // we make the quantity invalid numbers

      const res = await reserve(body({ quantity }));

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ quantity: "Please enter a whole number of at least 1." });
      expect(writer.saved).toEqual([]);
      // we expect the response to be 422
    });
  });
  // end of AC7

  // AC8: Given that I have not specified a date and time period, when I attempt to make the reservation, the
  // system should prompt me to specify the date and time period.
  describe("SCRUM-19/AC8 date and time period not specified", () => {
    it("19-S8: no date, start or end time is refused with a prompt for each, and nothing is saved", async () => {
      const { reserve, writer } = setup();

      const res = await reserve(body({ date: "", startTime: "", endTime: "" }));
      // we make date, startTime and endTime to be empty

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({
        date: "Please enter a date.",
        startTime: "Please enter a start time.",
        endTime: "Please enter an end time.",
      });
      expect(writer.saved).toEqual([]);
    });

    it("19-S8: a badly formatted time is refused, with the same message as the availability check", async () => {
      const { reserve, writer } = setup();

      const res = await reserve(body({ startTime: "9am" }));
      // we make startTime to be in 24hr format 

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ startTime: "Please enter the start time as HH:MM." });
      // we expect the response to be 422 with a prompt to enter the start time in 24hr format
      expect(writer.saved).toEqual([]);
    });

    it("19-S8: an end time that is not after the start time is refused", async () => {
      const { reserve, writer } = setup();

      const res = await reserve(body({ startTime: "17:00", endTime: "09:00" }));
      // we make end time before start time 

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ endTime: "The end time must be after the start time." });
      // we expect 422 error
      expect(writer.saved).toEqual([]);
    });

    it("19-S8: a period in the past is refused (the clock says it is 6 Oct 2026)", async () => {
      const { reserve, writer } = setup();

      const res = await reserve(body({ date: "2026-10-01" }));
      // we make the date to be in the past

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ startTime: "The date and time must not be in the past." });
      // we expect 422 error
      expect(writer.saved).toEqual([]);
    });
  });
  // end of AC8

  // AC3: Given that the reservation has been made, when I check availability for the same equipment and period, the
  // system should show the quantity available reduced by the amount reserved.
  describe("SCRUM-19/AC3 availability drops after a reservation", () => {
    it("19-S3: after reserving 4 of 10 Projector Units, the availability check for that period shows 6", async () => {
      // One shared list: the writer saves into it, and the availability check reads from it.
      const stored: ReservationInfo[] = [];
      const { reserve, check } = setup([anEquipment()], new FakeReservationWriter(undefined, stored), [anEvent()], stored);

      expect((await check()).body.availableQuantity).toBe(10);
      // initially, we have 10 projector units available

      await reserve(body());
      // we reserve 4 projector units

      expect((await check()).body.availableQuantity).toBe(6);
      // we now expect the availability to be 6
    });
  });
  // end of AC3

  // AC4: Given that I have selected equipment and a quantity that is more than what is available for the period,
  // when I attempt to make the reservation, the system should reject it and inform me that there is not enough.
  describe("SCRUM-19/AC4 more than is available", () => {
    it("19-S4: asking for more than is free is refused with 409, says how many are free, and saves nothing", async () => {
      // The writer says only 3 are free in that period, and we ask for 4.
      const { reserve, writer } = setup([anEquipment()], new FakeReservationWriter({ ok: false, available: 3 }));

      const res = await reserve(body());

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        code: "INSUFFICIENT",
        error: "Only 3 available for that period, but you asked for 4.",
        available: 3,
      });
      expect(writer.saved).toEqual([]);
    });
  });
  // end of AC4

  // AC6 (also): an equipment id that is not in the catalogue is treated like no equipment selected. The form cannot
  // send one, but anyone can call the endpoint directly.
  describe("SCRUM-19/AC6 equipment that does not exist", () => {
    it("19-S6: an equipment id that is not in the catalogue is refused with a prompt to select the equipment", async () => {
      const { reserve, writer } = setup();

      const res = await reserve(body({ equipmentId: "eq-does-not-exist" }));
      // we name the equipment id "eq-does-not-exist"

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ equipmentId: "Please select the equipment." });
      // we should get this error message if the equipment id does not exist
      expect(writer.saved).toEqual([]);
    });
  });
  // end of equipment that does not exist

  // 19-S10: equipment that is damaged, under maintenance or retired cannot be reserved: none of it is available.
  describe("SCRUM-19 equipment that cannot be used (19-S10)", () => {
    it.each(["damaged", "under_maintenance", "retired"] as const)(
      "19-S10: equipment that is %s is refused with 409 and 0 available, and nothing is saved",
      async (operationalStatus) => {
        // Writer left on its default (it would accept), so the refusal has to come from the service itself.
        const { reserve, writer } = setup([anEquipment({ operationalStatus })]);

        const res = await reserve(body());

        expect(res.status).toBe(409);
        // we want to give a 409 error when equipment is damaged, under maintenance or retired
        expect(res.body).toEqual({
          code: "INSUFFICIENT",
          error: "Only 0 available for that period, but you asked for 4.",
          available: 0,
        });
        expect(writer.saved).toEqual([]);
      },
    );
  });
  // end of equipment that cannot be used

  // 19-S14: the form's event dropdown lists the events equipment can be reserved for: approved or further along, not
  // started yet, soonest first, with the date and times the form pre-fills (Singapore time) and the coordinator.
  describe("SCRUM-19 events to reserve for (19-S14)", () => {
    it("19-S14: lists only eligible events, soonest first, with their date, times and coordinator", async () => {
      const { listEvents } = setup([anEquipment()], new FakeReservationWriter(), [
        anEvent({ id: "evt-later", name: "Later Event", start: new Date("2026-10-20T01:00:00Z"), end: new Date("2026-10-20T09:00:00Z") }),
        // this scenario will be approved because the event is in october 20 which is later than today 
        anEvent({ id: "evt-sooner", name: "Sooner Event", status: "confirmed", start: new Date("2026-10-12T02:30:00Z"), end: new Date("2026-10-12T10:00:00Z"), coordinatorName: "Ravi Nair" }),
        // this scenario will be approved because the event is in october 12 which is later than today
        anEvent({ id: "evt-draft", status: "draft" }),
        // this scenario will be rejected because the event is still in draft
        anEvent({ id: "evt-cancelled", status: "cancelled" }),
        // this scenario will be rejected because the event is cancelled
        anEvent({ id: "evt-started", start: new Date("2026-10-05T01:00:00Z"), end: new Date("2026-10-05T09:00:00Z") }),
        // this scenario will be rejected because the event has already started
      ]);

      const res = await listEvents();

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: "evt-sooner", name: "Sooner Event", date: "2026-10-12", startTime: "10:30", endTime: "18:00", coordinatorName: "Ravi Nair" },
        { id: "evt-later", name: "Later Event", date: "2026-10-20", startTime: "09:00", endTime: "17:00", coordinatorName: "Dana Lim" },
      ]);
    });
  });
  // end of events to reserve for

  // 19-S13: only Technical Support Staff may reserve equipment. Not signed in is 401; signed in as anyone else is 403.
  describe("SCRUM-19 Technical Support Staff only (19-S13)", () => {
    it("19-S13: not signed in gets 401, and nothing is saved", async () => {
      const { reserve, writer } = setup();

      const res = await reserve(body(), null);

      expect(res.status).toBe(401);
      expect(writer.saved).toEqual([]);
    });

    // Every role in the shared ROLES list except Technical Support Staff, so a role added later (e.g. the
    // Week 7 Event Coordinator Lead or Safety Officer) is refused here without anyone editing this test.
    const otherRoles = ROLES.filter((role) => role !== "technical_support_staff");

    it.each(otherRoles)("19-S13: a signed-in %s is not Technical Support Staff, so gets 403", async (role) => {
      const { reserve, writer } = setup();

      const res = await reserve(body(), `${role}-user`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ code: "FORBIDDEN", error: "You are not allowed to do that." });
      expect(writer.saved).toEqual([]);
    });

    // The event dropdown's endpoint has the same rule: it lists events for reserving, so it is Technical Support Staff only.
    // this is to test the backend service. before they can call to get the equipment list, we first check if the person is a technical support staff. if not, we will return 403 error
    // if person is not signed in, we will return 401 error
    it("19-S13: the event list is 401 when not signed in", async () => {
      const { listEvents } = setup();

      expect((await listEvents(null)).status).toBe(401);
    });

    it.each(otherRoles)("19-S13: a signed-in %s cannot list the events to reserve for, so gets 403", async (role) => {
      const { listEvents } = setup();

      const res = await listEvents(`${role}-user`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ code: "FORBIDDEN", error: "You are not allowed to do that." });
    });

    it("19-S13: a signed-in user with no role at all cannot list the events either", async () => {
      const { listEvents } = setup();

      expect((await listEvents("unknown-user")).status).toBe(403);
    });

    it("19-S13: a signed-in user with no role at all gets 403", async () => {
      const { reserve, writer } = setup();

      const res = await reserve(body(), "unknown-user");

      expect(res.status).toBe(403);
      expect(writer.saved).toEqual([]);
    });
  });
  // end of Technical Support Staff only

  // Event (agreed rule, not in the original criteria): a reservation must belong to an event, so a missing event
  // is prompted for like the other fields.
  describe("SCRUM-19 event not selected (19-S9)", () => {
    it("19-S9: no event selected is refused with a prompt to select it, and nothing is saved", async () => {
      const { reserve, writer } = setup();

      const res = await reserve(body({ eventId: "" }));

      expect(res.status).toBe(422);
      // if no event is selected, we will return 422 with a prompt to select the event
      expect(res.body.fieldErrors).toEqual({ eventId: "Please select the event." });
      expect(writer.saved).toEqual([]);
    });

    it("19-S9: when everything is missing, the event prompt appears together with the others", async () => {
      const { reserve } = setup();

      const res = await reserve({});

      expect(res.body.fieldErrors).toEqual({
        eventId: "Please select the event.",
        equipmentId: "Please select the equipment.",
        quantity: "Please enter the quantity required.",
        date: "Please enter a date.",
        startTime: "Please enter a start time.",
        endTime: "Please enter an end time.",
      });
    });
  });
  // end of event not selected

  // Event (agreed rule): equipment can only be reserved for an event that exists, is approved or further along, and
  // has not started yet.
  describe("SCRUM-19 event must be eligible (19-S9)", () => {
    it.each([
      ["does not exist", []],
      ["is still a draft", [anEvent({ status: "draft" })]],
      ["was cancelled", [anEvent({ status: "cancelled" })]],
      ["has already started", [anEvent({ start: new Date("2026-10-05T01:00:00Z") })]],
    ])("19-S9: an event that %s is refused, and nothing is saved", async (_reason, events) => {
      const { reserve, writer } = setup([anEquipment()], new FakeReservationWriter(), events);

      const res = await reserve(body());

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ eventId: "Please select an approved event that has not started yet." });
      expect(writer.saved).toEqual([]);
      // if event does not exist, is still a draft, was cancelled, or has already started, we will not be able to reserve the equipment and we will return 422 with a prompt to select an approved event that has not started yet
    });
  });
  // end of event must be eligible
});
// end of SCRUM-19
