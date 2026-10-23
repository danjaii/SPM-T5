import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { EquipmentInfo } from "../../src/readers/equipmentReader";
import type { ReservationInfo } from "../../src/readers/reservationReader";
import {
  FakeEquipmentReader,
  FakeEquipmentRequestReader,
  FakeEquipmentRequestReviewer,
  FakeEquipmentRequestWriter,
  FakeEventReader,
  FakeReservationReader,
  FakeReservationWriter,
  FakeVenueBookingReader,
  aReservation,
  anEquipment,
  fakeDeps,
  fakeRoles,
} from "../support/fakes";

// ----------------------------------------------------------------------------
// Test setup: the app with a fake catalogue and reservations. tech-1 is Technical Support Staff. The period asked
// about is 15 Oct 2026, 09:00 to 17:00 Singapore time, the same as aReservation()'s default.
// ----------------------------------------------------------------------------

const PERIOD = { date: "2026-10-15", startTime: "09:00", endTime: "17:00" };

function setup({ equipment = [anEquipment()], reservations = [] }: { equipment?: EquipmentInfo[]; reservations?: ReservationInfo[] } = {}) {
  const app = createApp(fakeDeps, {
    ports: () => ({
      events: new FakeEventReader(),
      equipment: new FakeEquipmentReader(equipment),
      reservations: new FakeReservationReader(reservations),
      roles: fakeRoles(),
      writer: new FakeReservationWriter(),
      venueBookings: new FakeVenueBookingReader(),
      requests: new FakeEquipmentRequestReader(),
      requestWriter: new FakeEquipmentRequestWriter(),
      reviewer: new FakeEquipmentRequestReviewer(),
    }),
  });
  return {
    inventory: (query: Record<string, string> = PERIOD, user: string | null = "tech-1") => {
      const req = request(app).get("/equipment-inventory").query(query);
      return user ? req.set("Cookie", `cs_session=tok-${user}`) : req;
    },
  };
}

// end of test setup

describe("SCRUM-137/AC2 inventory leaves out units that cannot be used and says why", () => {
  it("counts only free, working units, naming the events holding the rest and the items out of service", async () => {
    const res = await setup({
      equipment: [
        anEquipment(),
        anEquipment({ id: "eq-mic", name: "Wireless Microphone", type: "Audio", totalQuantity: 5, operationalStatus: "damaged" }),
      ],
      reservations: [aReservation({ eventName: "Robotics Meetup", quantityRequested: 4 })],
    }).inventory();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: "eq-projector", name: "Projector Unit", type: "AV", total: 10, available: 6, heldBy: [{ eventName: "Robotics Meetup", units: 4 }], outOfService: null },
      { id: "eq-mic", name: "Wireless Microphone", type: "Audio", total: 5, available: 0, heldBy: [], outOfService: "damaged" },
    ]);
  });

  it("shows a period that has already started, since the inventory books nothing", async () => {
    const res = await setup().inventory({ date: "2020-01-01", startTime: "09:00", endTime: "17:00" });
    expect(res.status).toBe(200);
  });

  it("asks for a missing or malformed period with SCRUM-18's messages", async () => {
    const { inventory } = setup();
    const missing = await inventory({ date: "", startTime: "09:00", endTime: "" });
    expect(missing.status).toBe(422);
    expect(missing.body.fieldErrors).toEqual({ date: "Please enter a date.", endTime: "Please enter an end time." });

    const backwards = await inventory({ ...PERIOD, endTime: "08:00" });
    expect(backwards.status).toBe(422);
    expect(backwards.body.fieldErrors).toEqual({ endTime: "The end time must be after the start time." });
  });
});

describe("SCRUM-137/AC2 inventory is for Technical Support Staff only", () => {
  it("needs a session", async () => {
    expect((await setup().inventory(PERIOD, null)).status).toBe(401);
  });

  it("refuses every other role", async () => {
    expect((await setup().inventory(PERIOD, "coord-1")).status).toBe(403);
  });
});
