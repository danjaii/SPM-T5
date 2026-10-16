import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import type { EventInfo } from "../../src/readers/eventReader";
import {
  FakeEquipmentReader,
  FakeEquipmentRequestReader,
  FakeEquipmentRequestReviewer,
  FakeEquipmentRequestWriter,
  FakeEventReader,
  FakeReservationReader,
  FakeReservationWriter,
  FakeVenueBookingReader,
  anEquipment,
  anEvent,
  fakeDeps,
  fakeRoles,
} from "../support/fakes";

/**
 * SCRUM-86, open question 1: if the customer decides a request need not name a venue, EQUIPMENT_REQUEST_VENUE_REQUIRED
 * is turned off and the shared parser lets a request through without one. This stands in for that parser, so the
 * service's no-venue path is ready and tested: the request then covers the event's own dates.
 */
vi.mock("@spm-t5/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@spm-t5/shared")>()),
  parseEquipmentRequestInput: () => ({
    ok: true,
    data: { equipmentId: "eq-projector", quantity: 1, venueBookingId: null, notes: null },
  }),
}));

function setup(event: EventInfo) {
  const writer = new FakeEquipmentRequestWriter();
  const app = createApp(fakeDeps, {
    ports: () => ({
      events: new FakeEventReader([event]),
      equipment: new FakeEquipmentReader([anEquipment()]),
      reservations: new FakeReservationReader(),
      roles: fakeRoles(),
      writer: new FakeReservationWriter(),
      venueBookings: new FakeVenueBookingReader(),
      requests: new FakeEquipmentRequestReader(),
      requestWriter: writer,
      reviewer: new FakeEquipmentRequestReviewer(),
    }),
  });
  const submit = () => request(app).post("/events/evt-devops/equipment-requests").set("Cookie", "cs_session=tok-coord-1").send({});
  return { submit, writer };
}

describe("SCRUM-86 open question 1: a request without a venue (if the rule is turned off)", () => {
  it("covers the event's own dates and shows no venue", async () => {
    const { submit, writer } = setup(anEvent());
    const res = await submit();

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ venueName: null, status: "SUBMITTED" });
    expect(writer.saved[0]).toMatchObject({
      venueBookingId: null,
      start: new Date("2026-10-15T01:00:00Z"),
      end: new Date("2026-10-15T09:00:00Z"),
    });
  });

  it("is refused when the event has no dates either, since there is no period to cover", async () => {
    const { submit, writer } = setup(anEvent({ start: null, end: null }));
    const res = await submit();

    expect(res.status).toBe(422);
    expect(Object.keys(res.body.fieldErrors)).toEqual(["venueBookingId"]);
    expect(writer.saved).toEqual([]);
  });
});
