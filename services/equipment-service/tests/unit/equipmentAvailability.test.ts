import { ROLES } from "@spm-t5/shared";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { EquipmentInfo } from "../../src/readers/equipmentReader";
import type { ReservationInfo } from "../../src/readers/reservationReader";
import { FakeEquipmentReader, FakeReservationReader, aReservation, anEquipment, fakeDeps, fakeRoles } from "../support/fakes";

// ----------------------------------------------------------------------------
// Test setup: the app with fake data, and a helper to ask it about availability.
// ----------------------------------------------------------------------------

// The clock: 2026-10-06 09:00 Singapore time.
const now = () => new Date("2026-10-06T01:00:00Z");

function setup(equipment: EquipmentInfo[] = [anEquipment()], reservations: ReservationInfo[] = []) {
  const app = createApp(fakeDeps, {
    now,
    ports: () => ({
      equipment: new FakeEquipmentReader(equipment),
      reservations: new FakeReservationReader(reservations),
      roles: fakeRoles(),
    }),
  });
  const get = (path: string, user: string | null = "tech-1") => {
    const req = request(app).get(path);
    return user ? req.set("Cookie", `cs_session=tok-${user}`) : req;
  };
  return { get };
}

// The question a Technical Support Staff member asks, filled in with ordinary values. These exist only in
// the tests (the real form starts empty), so each test can change just the one field it is about.
const EQUIPMENT_NAME = "Projector Unit";
const QUANTITY = "1";
const DATE = "2026-10-15";
const START_TIME = "09:00";
const END_TIME = "17:00";

/** GET /equipment-availability with the values above, except whatever a test changes. */
const query = (changes: Record<string, string> = {}) =>
  "/equipment-availability?" +
  new URLSearchParams({
    equipmentName: EQUIPMENT_NAME,
    quantity: QUANTITY,
    date: DATE,
    startTime: START_TIME,
    endTime: END_TIME,
    ...changes,
  }).toString();

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-18 Check Equipment Availability
// ----------------------------------------------------------------------------
describe("SCRUM-18 Check Equipment Availability", () => {
  // AC1: Given that I have specified an equipment name, requested quantity, date and time, when I check
  // availability, the system should compare the requested quantity against the quantity available at that
  // date and time and show me the available quantity.
  // pretend 10 projectors exist, 4 are booked, and the user asks for 5: the system should show 6 available.
  // tells us a value, like available quantity 
  describe("SCRUM-18/AC1 compare the requested quantity with what is available", () => {
    it("18-S1: 10 in total with 4 approved in the period shows 6 available, next to the 5 requested", async () => {
      const { get } = setup([anEquipment()], [aReservation({ quantityRequested: 4 })]);

      const res = await get(query({ quantity: "5" }));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        // The question, echoed back.
        equipmentName: EQUIPMENT_NAME,
        date: DATE,
        startTime: START_TIME,
        endTime: END_TIME,
        // What this test is really checking: 10 in total, 5 asked for, 10 - 4 booked = 6 available.
        totalQuantity: 10,
        requestedQuantity: 5,
        availableQuantity: 6,
      });
    });
  });
  // end of AC1

  // AC2: Given that the available quantity meets or exceeds the requested quantity, when I check
  // availability, the system should indicate that the equipment is available.
  // tell us whether we have enough or not, based on the quantity we requested 
  describe("SCRUM-18/AC2 enough equipment is available", () => {
    it("18-S2: asking for exactly what is available (6 of 6) says it is available", async () => {
      const { get } = setup([anEquipment()], [aReservation({ quantityRequested: 4 })]);

      const res = await get(query({ quantity: "6" }));

      expect(res.body).toMatchObject({ availableQuantity: 6, sufficient: true });
    });

    it("18-S2: asking for less than is available (3 of 10, nothing booked) says it is available", async () => {
      const { get } = setup([anEquipment()], []);

      const res = await get(query({ quantity: "3" }));

      expect(res.body).toMatchObject({ availableQuantity: 10, sufficient: true });
    });
  });
  // end of AC2

  // AC3: Given that the available quantity is less than the requested quantity, when I check availability,
  // the system should indicate that the equipment is insufficient and show me the shortfall.
  describe("SCRUM-18/AC3 not enough equipment", () => {
    it("18-S3: asking for 8 when 6 are available says it is insufficient, short by 2", async () => {
      const { get } = setup([anEquipment()], [aReservation({ quantityRequested: 4 })]);
      // anEquipment specifies that we want Projectors, which is specified in the database

      const res = await get(query({ quantity: "8" }));
      // we are requesting for 8

      expect(res.body).toMatchObject({ availableQuantity: 6, sufficient: false, shortfall: 2 });
    });

    it("18-S3: when there is enough, the shortfall is 0", async () => {
      const { get } = setup([anEquipment()], [aReservation({ quantityRequested: 4 })]);

      const res = await get(query({ quantity: "6" }));

      expect(res.body).toMatchObject({ sufficient: true, shortfall: 0 });
    });
  });
  // end of AC3

  // AC4: Given that I have not specified the equipment name, when I attempt to check availability, the
  // system should prompt me to provide the equipment name.
  describe("SCRUM-18/AC4 equipment name missing", () => {
    it("18-S4: an empty name is refused with a prompt to enter it", async () => {
      const { get } = setup();

      const res = await get(query({ equipmentName: "" }));
      // this means that in our query, we will not specify name 

      expect(res.status).toBe(422);
      // 422 is the standard HTTP code for "I understand your request, but some fields are invalid"
      expect(res.body.fieldErrors).toEqual({ equipmentName: "Please enter the equipment name." });
    });

    it("18-S4: a name of only spaces counts as missing too", async () => {
      const { get } = setup();

      const res = await get(query({ equipmentName: "   " }));

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ equipmentName: "Please enter the equipment name." });
    });
  });
  // end of AC4

  // AC5: Given that I have specified an equipment name that does not match any known equipment, when I
  // attempt to check availability, the system should inform me that the equipment name is invalid.
  describe("SCRUM-18/AC5 unknown equipment name", () => {
    it("18-S5: a name that is not in the catalogue is refused, saying it does not match any equipment", async () => {
      const { get } = setup();

      const res = await get(query({ equipmentName: "Hologram Projector" }));

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({
        equipmentName: "“Hologram Projector” does not match any equipment in the catalogue.",
      });
    });

    // the following means that if user types in the correct equipment name but the letter case is different, it should still return 200, ie pass 
    it("18-S11: a known name typed in different letter case still matches", async () => {
      const { get } = setup();

      const res = await get(query({ equipmentName: "projector UNIT" }));

      expect(res.status).toBe(200);
      expect(res.body.equipmentName).toBe("Projector Unit");
    });
  });
  // end of AC5

  // AC6: Given that I have not specified the date and time, when I attempt to check availability, the system
  // should prompt me to provide the date and time.
  describe("SCRUM-18/AC6 date or time missing", () => {
    it("18-S6: leaving the date and both times empty prompts for each of them", async () => {
      const { get } = setup();

      const res = await get(query({ date: "", startTime: "", endTime: "" }));
      //  we make date, start time and end time empty in our query

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({
        date: "Please enter a date.",
        startTime: "Please enter a start time.",
        endTime: "Please enter an end time.",
      });
    });

    it("18-S6: leaving only the start time empty prompts for just that one", async () => {
      const { get } = setup();

      const res = await get(query({ startTime: "" }));

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ startTime: "Please enter a start time." });
    });
  });
  // end of AC6

  // AC7: Given that I have specified a date and time that is invalid, such as a past date or a malformed time,
  // when I attempt to check availability, the system should inform me that the date and time entered is invalid.
  describe("SCRUM-18/AC7 invalid date or time", () => {
    it("18-S7: a date in the wrong format is refused", async () => {
      const { get } = setup();

      const res = await get(query({ date: "15/10/2026" }));
      // this means that in our query, we specify month, day, year instead of year, month, day

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ date: "Please enter the date as YYYY-MM-DD." });
    });

    it("18-S7: a date that does not exist (30 February) is refused", async () => {
      const { get } = setup();

      const res = await get(query({ date: "2026-02-30" }));
      // this means that in our query, we specify a date that does not exist

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ date: "Please enter a real date." });
    });

    it("18-S7: a time in the wrong format is refused", async () => {
      const { get } = setup();

      const res = await get(query({ startTime: "9am" }));
      // this means that in our query, we specify a time that is not in the correct format. the correct format should be 24 hour format

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ startTime: "Please enter the start time as HH:MM." });
    });

    it("18-S7: an end time that is not after the start time is refused", async () => {
      const { get } = setup();

      const res = await get(query({ startTime: "17:00", endTime: "09:00" }));
      // end time comes before start time, which is invalid

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ endTime: "The end time must be after the start time." });
    });

    it("18-S7: a period that has already started is refused (the clock says it is 6 Oct 2026)", async () => {
      const { get } = setup();

      const res = await get(query({ date: "2026-10-01" }));
      // this means that in our query, we specify a date that is in the past

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ startTime: "The date and time must not be in the past." });
    });
  });
  // end of AC7

  // Quantity (agreed rule, not in the original criteria): the quantity required must be given, as a whole
  // number of at least 1, so there is something to compare the available quantity against.
  describe("SCRUM-18 quantity must be given (18-S12)", () => {
    it("18-S12: leaving the quantity empty prompts for it", async () => {
      const { get } = setup();

      const res = await get(query({ quantity: "" }));
      // this means that we dont specify the quantity 

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ quantity: "Please enter the quantity required." });
    });

    it.each(["0", "-2", "2.5", "abc"])("18-S12: a quantity of %s is refused", async (quantity) => {
      // this means we key in weird values for quantity, like 0, negative numbers, decimal numbers and letters
      const { get } = setup();

      const res = await get(query({ quantity }));

      expect(res.status).toBe(422);
      expect(res.body.fieldErrors).toEqual({ quantity: "Please enter a whole number of at least 1." });
    });
  });
  // end of quantity

  // Which reservations use up stock (agreed rule): only approved and reserved ones. "requested" is still
  // undecided (often the very request being checked); "rejected" and "cancelled" never held anything.
  describe("SCRUM-18 which reservations use up stock (18-S8)", () => {
    it("18-S8: counts approved (2) and reserved (3), but not requested, rejected or cancelled", async () => {
      const { get } = setup(
        [anEquipment()],
        [
          aReservation({ status: "approved", quantityRequested: 2 }),
          aReservation({ status: "reserved", quantityRequested: 3 }),
          aReservation({ status: "requested", quantityRequested: 5 }),
          aReservation({ status: "rejected", quantityRequested: 5 }),
          aReservation({ status: "cancelled", quantityRequested: 5 }),
        ],
        // we set 2 equipment to be approved
        // we set 3 equipment to be reserved
        // we set 5 equipment to be requested
        // we set 5 equipment to be rejected
        // we set 5 equipment to be cancelled
      );

      const res = await get(query());

      // 10 in total - 2 approved - 3 reserved = 5 available.
      expect(res.body.availableQuantity).toBe(5);
    });
    // we expect that the available quantity is 5

    it("18-S8: uses the approved amount when staff approved fewer than were asked for", async () => {
      const { get } = setup([anEquipment()], [aReservation({ quantityRequested: 6, quantityReserved: 2 })]);

      const res = await get(query());

      // Asked for 6, but only 2 were approved: 10 - 2 = 8 available.
      expect(res.body.availableQuantity).toBe(8);
    });
  });
  // end of which reservations use up stock

  // Peak, not sum (agreed rule): available = total minus the most units in use at any one moment of the period.
  describe("SCRUM-18 peak use within the period (18-S9)", () => {
    /** A Singapore time on 15 Oct 2026, the day these checks ask about. */
    const at = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00+08:00`);

    it("18-S9: two bookings of 4 that do not overlap each other (morning, afternoon) leave 6 of 10", async () => {
      const { get } = setup(
        [anEquipment()],
        [
          aReservation({ start: at("09:00"), end: at("12:00"), quantityRequested: 4 }),
          aReservation({ start: at("13:00"), end: at("17:00"), quantityRequested: 4 }),
        ],
      );
      // we set 1 reservation that starts at 9am and ends at 12pm, with 4 equipment requested
      // we set another reservation that starts at 1pm and ends at 5pm, with 4 equipment requested

      const res = await get(query());
      // the timing that we want to reserve is 9am to 5pm

      // At most 4 are out at any one moment, so 10 - 4 = 6, not 10 - 8 = 2.
      expect(res.body.availableQuantity).toBe(6);
      // we expect that the available quantity is 6
    });

    it("18-S9: two bookings of 4 that do overlap each other (11:00 to 12:00) leave 2 of 10", async () => {
      const { get } = setup(
        [anEquipment()],
        [
          aReservation({ start: at("09:00"), end: at("12:00"), quantityRequested: 4 }),
          aReservation({ start: at("11:00"), end: at("15:00"), quantityRequested: 4 }),
        ],
      );
      // in this case, the timings have a one hour overlap. that is, at 11am, we will only have 2 equipment availabale

      const res = await get(query());

      // Between 11:00 and 12:00 all 8 are out at once, so 10 - 8 = 2.
      expect(res.body.availableQuantity).toBe(2);
      // thus, we expect quantity to be 2
    });

    it("18-S9: a booking that ends at 13:00 and another that starts at 13:00 never overlap", async () => {
      const { get } = setup(
        [anEquipment()],
        [
          aReservation({ start: at("09:00"), end: at("13:00"), quantityRequested: 6 }),
          aReservation({ start: at("13:00"), end: at("17:00"), quantityRequested: 6 }),
        ],
      );
      // for this, there is no overlap, so we expect output to be 4

      const res = await get(query());

      // The first 6 come back at 13:00 just as the next 6 go out, so at most 6 are out: 10 - 6 = 4.
      expect(res.body.availableQuantity).toBe(4);
    });
  });
  // end of peak use

  // Equipment that is not usable (agreed rule): damaged, under maintenance or retired equipment is still found
  // by name, but nothing of it is available, and the reply says which of those it is.
  describe("SCRUM-18 equipment that is not usable (18-S10)", () => {
    it.each(["damaged", "under_maintenance", "retired"] as const)(
      "18-S10: %s equipment is found, but has nothing available",
      async (operationalStatus) => {
        const { get } = setup([
          anEquipment({ id: "eq-led", name: "LED Wall Panel", totalQuantity: 2, operationalStatus }),
        ]);

        // this test runs 3 times:
        // LED Wall Panel is damaged, so nothing is available
        // LED Wall Panel is under maintenance, so nothing is available
        // LED Wall Panel is retired, so nothing is available

        const res = await get(query({ equipmentName: "LED Wall Panel", quantity: "1" }));
        // we ask for 1 LED Wall Panel

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
          equipmentName: "LED Wall Panel",
          operationalStatus,
          totalQuantity: 2,
          availableQuantity: 0,
          sufficient: false,
          shortfall: 1,
        });
        // this is the expected answer we want. total quantity to be 2, but available is 0, so we are short by 1. thus, sufficient is false
      },
    );
  });
  // end of equipment that is not usable

  // Who may check (agreed rule): Technical Support Staff only. Not signed in: 401. Any other role: 403.
  describe("SCRUM-18 Technical Support Staff only (18-S13)", () => {
    it("18-S13: someone who is not signed in gets 401", async () => {
      const { get } = setup();

      const res = await get(query(), null);

      expect(res.status).toBe(401);

      // if no login cookie, or, user is null, we return 401
    });

    // Every role in the shared ROLES list except Technical Support Staff, so a role added later (e.g. the
    // Week 7 Event Coordinator Lead or Safety Officer) is refused here without anyone editing this test.
    const otherRoles = ROLES.filter((role) => role !== "technical_support_staff");
    // as long as role is not technical support staff, we will return 403

    it.each(otherRoles)("18-S13: a signed-in %s is not Technical Support Staff, so gets 403", async (role) => {
      const { get } = setup();

      const res = await get(query(), `${role}-user`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ code: "FORBIDDEN", error: "You are not allowed to do that." });
    });

    it("18-S13: a signed-in user with no role at all gets 403", async () => {
      const { get } = setup();

      const res = await get(query(), "unknown-user");

      expect(res.status).toBe(403);
    });
  });
  // end of Technical Support Staff only

  // Equipment names for the form's suggestions (18-S11): GET /equipment lists the catalogue, so the user can
  // pick a name instead of guessing it. Same access rule as the check itself.
  describe("SCRUM-18 equipment names for the form's suggestions", () => {
    it("lists every item in name order, including ones that are not usable", async () => {
      const { get } = setup([
        anEquipment({ id: "eq-z", name: "Whiteboard Easel" }),
        anEquipment(),
        anEquipment({ id: "eq-led", name: "LED Wall Panel", operationalStatus: "damaged" }),
      ]);

      const res = await get("/equipment");

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: "eq-led", name: "LED Wall Panel", operationalStatus: "damaged" },
        { id: "eq-projector", name: "Projector Unit", operationalStatus: "available" },
        { id: "eq-z", name: "Whiteboard Easel", operationalStatus: "available" },
      ]);
    });

    it("refuses anyone who is not Technical Support Staff (403), like the check", async () => {
      const { get } = setup();

      const res = await get("/equipment", "venue_staff-user");

      expect(res.status).toBe(403);
    });
  });
  // end of equipment names
});
// end of SCRUM-18
