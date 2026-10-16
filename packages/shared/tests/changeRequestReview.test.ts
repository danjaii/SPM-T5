import { describe, expect, it } from "vitest";
import {
  CHANGE_REQUEST_REVIEW_MESSAGES,
  parseChangeRequestRejection,
  readChangeRequest,
} from "../src/changeRequestReview";
import type { CurrentEventDetails } from "../src/eventDetails";

// ----------------------------------------------------------------------------
// SCRUM-67 (docs/specs/review-change-request.md): a change request read against the event as it is now. Test setup: the
// event is on Sat 12 Dec 2026, 9am to 5pm Singapore time, for 120 people.
// ----------------------------------------------------------------------------

const event: CurrentEventDetails = {
  name: "Tech Summit",
  description: null,
  purpose: null,
  event_category_id: null,
  preferred_start_datetime: "2026-12-12T01:00:00+00:00",
  preferred_end_datetime: "2026-12-12T09:00:00+00:00",
  expected_attendance: 120,
  preferred_room_layout_id: null,
  accessibility_requirements: null,
  venue_requirements: "Stage",
  equipment_requirements_notes: null,
};

describe("SCRUM-67/AC2 each requested change with the current value (67-S2)", () => {
  it("67-S2: lists each field in the edit form's order with its label, current and requested value", () => {
    const read = readChangeRequest(
      {
        expected_attendance: { from: 120, to: 150 },
        preferred_start_datetime: { from: "2026-12-12T01:00:00.000Z", to: "2026-12-13T01:00:00.000Z" },
      },
      event,
    );
    expect(read.rows).toEqual([
      {
        field: "preferred_start_datetime",
        label: "Start",
        current: "2026-12-12T01:00:00+00:00",
        requested: "2026-12-13T01:00:00.000Z",
        changedSince: false,
        supported: true,
      },
      { field: "expected_attendance", label: "Expected attendance", current: 120, requested: 150, changedSince: false, supported: true },
    ]);
    expect(read.outdated).toBe(false);
    expect(read.unsupported).toEqual([]);
  });

  it("67-S3: gives the changes to save, each from the value the request was made against", () => {
    const read = readChangeRequest({ expected_attendance: { from: 120, to: 150 } }, event);
    expect(read.changes).toEqual({ expected_attendance: { from: 120, to: 150 } });
  });
});

describe("SCRUM-67/AC3 a request the event has moved on from (67-S5)", () => {
  it("67-S5: a field changed since the request is marked, and the request is outdated", () => {
    const read = readChangeRequest({ expected_attendance: { from: 100, to: 150 } }, event);
    expect(read.rows[0]).toMatchObject({ current: 120, requested: 150, changedSince: true });
    expect(read.outdated).toBe(true);
  });

  it("67-S5: the same time written another way is not a change; text that is empty or missing counts as none", () => {
    const read = readChangeRequest(
      {
        preferred_end_datetime: { from: "2026-12-12T17:00:00+08:00", to: "2026-12-12T10:00:00.000Z" },
        equipment_requirements_notes: { from: "", to: "Two projectors" },
      },
      event,
    );
    expect(read.outdated).toBe(false);
  });

  it("67-S5: a requested time that no longer matches the event is outdated", () => {
    const read = readChangeRequest({ preferred_start_datetime: { from: "2026-12-11T01:00:00Z", to: "2026-12-13T01:00:00Z" } }, event);
    expect(read.outdated).toBe(true);
  });
});

describe("SCRUM-67 seeded requests, which hold only the new value (67-S5)", () => {
  it("67-S5: a plain value is read as a change from the event's current value", () => {
    const read = readChangeRequest({ expected_attendance: 220, accessibility_requirements: "Sign language" }, event);
    expect(read.changes).toEqual({
      expected_attendance: { from: 120, to: 220 },
      accessibility_requirements: { from: null, to: "Sign language" },
    });
    expect(read.outdated).toBe(false);
  });

  it("67-S5: a field the system cannot apply is listed, by a readable label, and blocks approval", () => {
    const read = readChangeRequest({ registration_capacity: 38, expected_attendance: 220 }, event);
    expect(read.unsupported).toEqual(["registration_capacity"]);
    expect(read.rows.at(-1)).toEqual({
      field: "registration_capacity",
      label: "Registration capacity",
      current: null,
      requested: 38,
      changedSince: false,
      supported: false,
    });
    expect(read.changes).toEqual({ expected_attendance: { from: 120, to: 220 } });
  });

  it("67-S5: no changes at all (or not an object) reads as nothing to apply", () => {
    for (const proposed of [null, [], "x"]) {
      expect(readChangeRequest(proposed, event)).toEqual({ rows: [], changes: {}, outdated: false, unsupported: [] });
    }
  });
});

describe("SCRUM-67/AC4 the reason for rejecting (67-S6)", () => {
  it("67-S6: is required, trimmed, and at most 2000 characters", () => {
    expect(parseChangeRequestRejection({ reason: "  Venue is fully booked " })).toEqual({ ok: true, reason: "Venue is fully booked" });
    expect(parseChangeRequestRejection({ reason: "  " })).toEqual({ ok: false, error: CHANGE_REQUEST_REVIEW_MESSAGES.reasonMissing });
    expect(parseChangeRequestRejection(null)).toEqual({ ok: false, error: CHANGE_REQUEST_REVIEW_MESSAGES.reasonMissing });
    expect(parseChangeRequestRejection({ reason: "x".repeat(2001) })).toEqual({
      ok: false,
      error: CHANGE_REQUEST_REVIEW_MESSAGES.reasonTooLong,
    });
  });
});
