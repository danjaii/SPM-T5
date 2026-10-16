import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import type { EquipmentRequestInfo } from "../../src/readers/equipmentRequestReader";
import {
  FakeEquipmentReader,
  FakeEquipmentRequestReader,
  FakeEquipmentRequestReviewer,
  FakeEquipmentRequestWriter,
  FakeEventReader,
  FakeReservationReader,
  FakeReservationWriter,
  FakeVenueBookingReader,
  anEquipmentRequest,
  anEvent,
  fakeDeps,
  fakeRoles,
} from "../support/fakes";

/**
 * SCRUM-113/AC3: an equipment request sent back for review after an important event change (migration 39) shows
 * Technical Support Staff what changed, and the coordinator sees it is waiting for review again
 * (docs/specs/send-back-affected-arrangements.md). The database stores the note and clears it on the next review
 * (event-service tests/integration/sendBackDb.test.ts); these cover how equipment-service shows it.
 */

// ----------------------------------------------------------------------------
// Test setup: tech-1 is Technical Support Staff; coord-1 is the assigned coordinator of "evt-devops" (see fakes.ts).
// req-1 was sent back after the event changed; req-2 was not.
// ----------------------------------------------------------------------------

const SENT_BACK_AT = new Date("2026-10-02T03:00:00.000Z");

/** The note migration 39 stores: the start, attendance, layout, venue and equipment requirements all changed. */
const NOTE = {
  preferred_start_datetime: { from: "2026-10-15T01:00:00.000Z", to: "2026-10-16T01:00:00.000Z" },
  expected_attendance: { from: 480, to: 600 },
  preferred_room_layout_id: { from: "layout-theatre", to: "layout-banquet" },
  venue_requirements: { from: null, to: "Stage" },
  equipment_requirements_notes: { from: "Two projectors", to: "Three projectors" },
};

function setup(stored: EquipmentRequestInfo[] = [
  anEquipmentRequest({ sentBackChanges: NOTE, sentBackAt: SENT_BACK_AT }),
  anEquipmentRequest({ id: "req-2", equipmentName: "Microphone", createdAt: new Date("2026-10-01T02:00:00Z") }),
]) {
  const app = createApp(fakeDeps, {
    ports: () => ({
      events: new FakeEventReader([anEvent()]),
      equipment: new FakeEquipmentReader(),
      reservations: new FakeReservationReader(),
      roles: fakeRoles(),
      writer: new FakeReservationWriter(),
      venueBookings: new FakeVenueBookingReader(),
      requests: new FakeEquipmentRequestReader(stored),
      requestWriter: new FakeEquipmentRequestWriter(),
      reviewer: new FakeEquipmentRequestReviewer(undefined, stored),
    }),
  });
  const get = (path: string, user: string) => request(app).get(path).set("Cookie", `cs_session=tok-${user}`);
  return { get };
}

/** What Technical Support Staff are shown: only the changes that matter for equipment, in the edit form's order. */
const SHOWN = {
  sentBackAt: SENT_BACK_AT.toISOString(),
  changes: [
    { field: "preferred_start_datetime", label: "Start", from: "2026-10-15T01:00:00.000Z", to: "2026-10-16T01:00:00.000Z" },
    { field: "expected_attendance", label: "Expected attendance", from: 480, to: 600 },
    { field: "equipment_requirements_notes", label: "Equipment requirements", from: "Two projectors", to: "Three projectors" },
  ],
};

// end of test setup

describe("SCRUM-113/AC3 Technical Support Staff see what changed on an equipment request sent back for review", () => {
  it("113-S8: the queue item carries what changed and when, leaving out the room layout and venue requirements", async () => {
    const res = await setup().get("/equipment-requests", "tech-1");

    expect(res.status).toBe(200);
    expect(res.body.find((r: { id: string }) => r.id === "req-1").sentBack).toEqual(SHOWN);
    expect(res.body.find((r: { id: string }) => r.id === "req-2").sentBack).toBeNull();
  });

  it("113-S8: the request's own review page carries it too", async () => {
    const res = await setup().get("/equipment-requests/req-1", "tech-1");

    expect(res.status).toBe(200);
    expect(res.body.sentBack).toEqual(SHOWN);
  });

  it("113-S8: a sent-back note with no equipment-related change shows no lines, but still says when", async () => {
    const onlyVenue = anEquipmentRequest({ sentBackChanges: { venue_requirements: { from: null, to: "Stage" } }, sentBackAt: SENT_BACK_AT });

    const res = await setup([onlyVenue]).get("/equipment-requests/req-1", "tech-1");

    expect(res.body.sentBack).toEqual({ sentBackAt: SENT_BACK_AT.toISOString(), changes: [] });
  });
});

describe("SCRUM-113/AC2 the coordinator sees an equipment request waiting for review again (113-S14)", () => {
  it("113-S14: the event's equipment requests mark the one sent back", async () => {
    const res = await setup().get("/events/evt-devops/equipment-requests", "coord-1");

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.requests.map((r: { id: string; sentBackForReview: boolean }) => [r.id, r.sentBackForReview]));
    expect(byId).toEqual({ "req-1": true, "req-2": false });
  });
});
