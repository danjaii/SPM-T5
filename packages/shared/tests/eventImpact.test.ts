import { describe, expect, it } from "vitest";
import type { CurrentEventDetails, EventDetailsChanges } from "../src/eventDetails";
import {
  affectedArrangements,
  type ImpactEquipmentRequest,
  type ImpactVenueBooking,
} from "../src/eventImpact";

// ----------------------------------------------------------------------------
// Test setup (docs/specs/important-change-impact.md). The event is on Sat 12 Dec 2026, 9am to 5pm Singapore time, for 480
// people. It has:
// - Orchid Hall (holds 500), 10am to 12pm, approved, using the event's 480 people;
// - Breakout Room (holds 50), 1pm to 3pm, pending, with its own 40 people (SCRUM-98);
// - 2 projectors for Orchid Hall, 10am to 12pm, submitted.
// ----------------------------------------------------------------------------

const event: CurrentEventDetails = {
  name: "Tech Summit",
  description: null,
  purpose: null,
  event_category_id: null,
  preferred_start_datetime: "2026-12-12T01:00:00.000Z",
  preferred_end_datetime: "2026-12-12T09:00:00.000Z",
  expected_attendance: 480,
  preferred_room_layout_id: "layout-theatre",
  accessibility_requirements: null,
  venue_requirements: null,
  equipment_requirements_notes: "Two projectors",
};

const orchidHall: ImpactVenueBooking = {
  id: "vb-orchid",
  venueName: "Orchid Hall",
  venueCapacity: 500,
  status: "approved",
  start: "2026-12-12T02:00:00.000Z",
  end: "2026-12-12T04:00:00.000Z",
  expectedAttendance: 480,
};

const breakoutRoom: ImpactVenueBooking = {
  id: "vb-breakout",
  venueName: "Breakout Room",
  venueCapacity: 50,
  status: "requested",
  start: "2026-12-12T05:00:00.000Z",
  end: "2026-12-12T07:00:00.000Z",
  expectedAttendance: 40,
};

const projectors: ImpactEquipmentRequest = {
  id: "eq-projectors",
  equipmentName: "Projector",
  quantity: 2,
  status: "requested",
  start: "2026-12-12T02:00:00.000Z",
  end: "2026-12-12T04:00:00.000Z",
};

const venueBookings = [orchidHall, breakoutRoom];
const equipmentRequests = [projectors];

/** The ids of the arrangements a change affects. */
function affectedIds(changes: EventDetailsChanges, bookings = venueBookings, equipment = equipmentRequests): string[] {
  return affectedArrangements(changes, event, bookings, equipment).map((a) => a.id);
}

/** The event moved to Sun 13 Dec, same hours. */
const moveToNextDay: EventDetailsChanges = {
  preferred_start_datetime: { from: event.preferred_start_datetime, to: "2026-12-13T01:00:00.000Z" },
  preferred_end_datetime: { from: event.preferred_end_datetime, to: "2026-12-13T09:00:00.000Z" },
};

describe("SCRUM-112/AC6 important change with no affected arrangements", () => {
  it("112-S15: an event with no venue bookings or equipment requests has nothing affected", () => {
    expect(affectedIds(moveToNextDay, [], [])).toEqual([]);
  });

  it("112-S16: an ordinary change (the name) affects nothing, even with arrangements", () => {
    expect(affectedIds({ name: { from: "Tech Summit", to: "Tech Summit 2026" } })).toEqual([]);
  });
});

describe("SCRUM-112/AC2 attendance exceeds venue capacity", () => {
  it("112-S4: 480 to 600 lists Orchid Hall (holds 500), saying it may no longer be suitable", () => {
    const [hall] = affectedArrangements({ expected_attendance: { from: 480, to: 600 } }, event, venueBookings, equipmentRequests);
    expect(hall.id).toBe("vb-orchid");
    expect(hall.reasons).toEqual([
      "Orchid Hall holds 500 people, but the event now expects 600. This venue booking is for 480. The venue may no longer be suitable.",
    ]);
  });

  it("112-S5: a venue that still holds the new number is listed too, with the numbers, for the coordinator to check", () => {
    const bigHall = { ...orchidHall, venueName: "Grand Ballroom", venueCapacity: 800 };
    const [hall] = affectedArrangements({ expected_attendance: { from: 480, to: 600 } }, event, [bigHall], []);
    expect(hall.reasons).toEqual([
      "The event now expects 600 people. This venue booking is for 480, and Grand Ballroom holds 800. Check it still suits.",
    ]);
  });

  it("112-S6: a venue booking with its own number (Breakout Room, 40) is listed, saying it is for 40", () => {
    const affected = affectedArrangements({ expected_attendance: { from: 480, to: 600 } }, event, venueBookings, equipmentRequests);
    expect(affected.map((a) => a.id)).toEqual(["vb-orchid", "vb-breakout"]);
    expect(affected[1].reasons).toEqual([
      "Breakout Room holds 50 people, but the event now expects 600. This venue booking is for 40. The venue may no longer be suitable.",
    ]);
  });

  it("112-S6: a venue booking with no number of its own leaves that sentence out", () => {
    const noNumber = { ...orchidHall, expectedAttendance: null };
    const [hall] = affectedArrangements({ expected_attendance: { from: 480, to: 600 } }, event, [noNumber], []);
    expect(hall.reasons).toEqual(["Orchid Hall holds 500 people, but the event now expects 600. The venue may no longer be suitable."]);
    const [fits] = affectedArrangements({ expected_attendance: { from: 480, to: 490 } }, event, [noNumber], []);
    expect(fits.reasons).toEqual(["The event now expects 490 people. Orchid Hall holds 500. Check it still suits."]);
  });

  it("112-S4: a venue booking whose number no longer matches the event (changed earlier) is still listed", () => {
    // the bug that made us list every venue booking: after an earlier change from 480 to 500, the booking still says 480
    const earlier = { ...event, expected_attendance: 500 };
    const ids = affectedArrangements({ expected_attendance: { from: 500, to: 600 } }, earlier, [orchidHall], []).map((a) => a.id);
    expect(ids).toEqual(["vb-orchid"]);
  });

  it("112-S4: attendance raised from no number at all lists the venue bookings too", () => {
    const noAttendance = { ...event, expected_attendance: null };
    expect(affectedArrangements({ expected_attendance: { from: null, to: 600 } }, noAttendance, [orchidHall], []).map((a) => a.id))
      .toEqual(["vb-orchid"]);
  });

  it("112-S7: lowering the attendance lists no venue booking", () => {
    expect(affectedIds({ expected_attendance: { from: 480, to: 300 } })).toEqual([]);
  });
});

describe("SCRUM-112/AC3 event time no longer covers existing arrangements", () => {
  it("112-S8: moving the event to another day lists every venue booking and equipment request on the old day", () => {
    const affected = affectedArrangements(moveToNextDay, event, venueBookings, equipmentRequests);
    expect(affected.map((a) => a.id)).toEqual(["vb-orchid", "vb-breakout", "eq-projectors"]);
    expect(affected.every((a) => a.reasons.includes("No longer within the event's new date and time."))).toBe(true);
  });

  it("112-S9: ending the event later keeps every arrangement inside, so nothing is listed", () => {
    expect(affectedIds({ preferred_end_datetime: { from: event.preferred_end_datetime, to: "2026-12-12T11:00:00.000Z" } }))
      .toEqual([]);
  });

  it("112-S10: starting at 11am lists Orchid Hall and its projectors (10am), not the 1pm Breakout Room", () => {
    expect(affectedIds({ preferred_start_datetime: { from: event.preferred_start_datetime, to: "2026-12-12T03:00:00.000Z" } }))
      .toEqual(["vb-orchid", "eq-projectors"]);
  });

  it("112-S10: an event with no end time yet has no period to fall outside, so nothing is listed for its time", () => {
    const noEnd = { ...event, preferred_end_datetime: null };
    const changes = { preferred_start_datetime: { from: event.preferred_start_datetime, to: "2026-12-13T01:00:00.000Z" } };
    expect(affectedArrangements(changes, noEnd, venueBookings, equipmentRequests)).toEqual([]);
  });
});

describe("SCRUM-112/AC1 list affected arrangements", () => {
  it.each(["preferred_room_layout_id", "accessibility_requirements", "venue_requirements"] as const)(
    "112-S11: changing %s lists every active venue booking, not the equipment",
    (field) => {
      const affected = affectedArrangements({ [field]: { from: event[field], to: "changed" } }, event, venueBookings, equipmentRequests);
      expect(affected.map((a) => a.id)).toEqual(["vb-orchid", "vb-breakout"]);
      expect(affected[0].reasons).toEqual(["The event's venue requirements changed. Check this venue still suits them."]);
    },
  );

  it("112-S12: changing the equipment requirements lists every active equipment request, not the venues", () => {
    const affected = affectedArrangements(
      { equipment_requirements_notes: { from: "Two projectors", to: "Three projectors" } },
      event, venueBookings, equipmentRequests,
    );
    expect(affected.map((a) => a.id)).toEqual(["eq-projectors"]);
    expect(affected[0].reasons).toEqual(["The event's equipment requirements changed. Check this request still meets them."]);
  });

  it("112-S3: rejected, withdrawn or cancelled venue bookings and released or refused equipment are never listed", () => {
    const bookings = ["rejected", "withdrawn", "cancelled"].map((status) => ({ ...orchidHall, id: `vb-${status}`, status }));
    const equipment = ["rejected", "cancelled"].map((status) => ({ ...projectors, id: `eq-${status}`, status }));
    expect(affectedIds(moveToNextDay, bookings, equipment)).toEqual([]);
  });

  it("112-S2: each listed arrangement says its kind, what it is, its times, its status and why", () => {
    const affected = affectedArrangements(moveToNextDay, event, venueBookings, equipmentRequests);
    expect(affected[0]).toEqual({
      kind: "venue_booking",
      id: "vb-orchid",
      name: "Orchid Hall",
      quantity: null,
      start: "2026-12-12T02:00:00.000Z",
      end: "2026-12-12T04:00:00.000Z",
      statusLabel: "Approved",
      reasons: ["No longer within the event's new date and time."],
    });
    expect(affected[2]).toMatchObject({ kind: "equipment_request", name: "Projector", quantity: 2, statusLabel: "Submitted" });
  });

  it("112-S2: an arrangement affected two ways is listed once, with both reasons", () => {
    const affected = affectedArrangements(
      { ...moveToNextDay, expected_attendance: { from: 480, to: 600 } },
      event, venueBookings, equipmentRequests,
    );
    expect(affected.filter((a) => a.id === "vb-orchid")).toHaveLength(1);
    expect(affected[0].reasons).toHaveLength(2);
  });
});
