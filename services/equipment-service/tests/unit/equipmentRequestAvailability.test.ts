import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { EquipmentInfo } from "../../src/readers/equipmentReader";
import type { EquipmentRequestInfo } from "../../src/readers/equipmentRequestReader";
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
  anEquipmentRequest,
  fakeDeps,
  fakeRoles,
} from "../support/fakes";

// ----------------------------------------------------------------------------
// Test setup: the app with fake data. tech-1 is Technical Support Staff. By default the catalogue has 10 working
// Projector Units and the request (req-1) needs some of them on 15 Oct 2026, 09:00 to 17:00 Singapore time.
// ----------------------------------------------------------------------------

function setup({
  stored = [anEquipmentRequest()],
  equipment = [anEquipment()],
  reservations = [],
}: { stored?: EquipmentRequestInfo[]; equipment?: EquipmentInfo[]; reservations?: ReservationInfo[] } = {}) {
  const app = createApp(fakeDeps, {
    ports: () => ({
      events: new FakeEventReader(),
      equipment: new FakeEquipmentReader(equipment),
      reservations: new FakeReservationReader(reservations),
      roles: fakeRoles(),
      writer: new FakeReservationWriter(),
      venueBookings: new FakeVenueBookingReader(),
      requests: new FakeEquipmentRequestReader(stored),
      requestWriter: new FakeEquipmentRequestWriter(),
      reviewer: new FakeEquipmentRequestReviewer(undefined, stored),
    }),
  });
  return {
    detail: (id = "req-1") => request(app).get(`/equipment-requests/${id}`).set("Cookie", "cs_session=tok-tech-1"),
  };
}

// end of test setup

describe("SCRUM-137/AC1 available versus needed for a requested item", () => {
  it("shows 4 available against 6 needed, not enough, when 6 of 10 are held by another event in its time window", async () => {
    const res = await setup({
      stored: [anEquipmentRequest({ quantity: 6 })],
      reservations: [aReservation({ quantityRequested: 6 })],
    }).detail();
    expect(res.status).toBe(200);
    expect(res.body.availability).toMatchObject({ available: 4, needed: 6, sufficient: false });
  });

  it("names the other events holding units in that window, leaving out bookings that hold nothing", async () => {
    const res = await setup({
      stored: [anEquipmentRequest({ quantity: 6 })],
      reservations: [
        aReservation({ eventName: "Robotics Meetup", quantityRequested: 6, quantityReserved: 4 }),
        aReservation({ eventName: "Film Society", status: "requested", quantityRequested: 3 }),
      ],
    }).detail();
    expect(res.body.availability).toMatchObject({ available: 6, heldBy: [{ eventName: "Robotics Meetup", units: 4 }] });
  });

  it("says why none are available when the item is out of service", async () => {
    const res = await setup({ equipment: [anEquipment({ operationalStatus: "under_maintenance" })] }).detail();
    expect(res.body.availability).toMatchObject({ available: 0, sufficient: false, outOfService: "under_maintenance" });
  });

  it("has no out-of-service reason for working equipment", async () => {
    const res = await setup().detail();
    expect(res.body.availability).toMatchObject({ available: 10, sufficient: true, outOfService: null });
  });

  it("is not shown once the request is Arranged, since its own units would then count against it", async () => {
    const res = await setup({
      stored: [anEquipmentRequest({ quantity: 6, status: "reserved" })],
      reservations: [aReservation({ quantityRequested: 6 })],
    }).detail();
    expect(res.body.availability).toBeNull();
  });
});
