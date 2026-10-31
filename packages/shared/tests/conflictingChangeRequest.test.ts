// SCRUM-176 — Hold a conflicting change request while one is pending (docs/specs/conflicting-change-request.md)

import { describe, expect, it } from "vitest";
import { changeRequestConflicts, conflictingRequestMessage, pendingChangeThings } from "../src";

const attendance = { expected_attendance: { from: 120, to: 150 } };
const start = { preferred_start_datetime: { from: "2031-03-03T01:00:00Z", to: "2031-03-04T01:00:00Z" } };
const end = { preferred_end_datetime: { from: "2031-03-03T09:00:00Z", to: "2031-03-04T09:00:00Z" } };
const venue = { venue_requirements: { from: null, to: "Theatre" } };
const equipment = { equipment_requirements_notes: { from: null, to: "Two projectors" } };

describe("SCRUM-176/AC1,AC2 which things a new request shares with the pending ones", () => {
  it("176-S1: a second attendance change conflicts with a pending attendance change", () => {
    expect(changeRequestConflicts(attendance, [attendance])).toEqual(["expected attendance"]);
  });

  it("176-S2: start and end time are one thing, date and time, so they conflict with each other", () => {
    expect(changeRequestConflicts(end, [start])).toEqual(["date and time"]);
    expect(changeRequestConflicts({ ...start, ...end }, [start])).toEqual(["date and time"]);
  });

  it("176-S3: names only the things both change, in a fixed order", () => {
    expect(changeRequestConflicts({ ...equipment, ...venue }, [{ ...attendance, ...venue }])).toEqual(["venue requirements"]);
    expect(changeRequestConflicts({ ...venue, ...start, ...attendance }, [venue, { ...attendance, ...end }])).toEqual([
      "expected attendance",
      "date and time",
      "venue requirements",
    ]);
  });

  it("176-S4: a request that changes only other things does not conflict", () => {
    expect(changeRequestConflicts(start, [attendance])).toEqual([]);
    expect(changeRequestConflicts(attendance, [])).toEqual([]);
  });

  it("176-S1: a seeded pending request holding only the new value still names its field", () => {
    expect(changeRequestConflicts(attendance, [{ expected_attendance: 220 }])).toEqual(["expected attendance"]);
  });

  it("176-S1: ignores what it cannot read, rather than refusing", () => {
    expect(changeRequestConflicts(attendance, [null, "text", { unknown_field: 1 }])).toEqual([]);
    expect(changeRequestConflicts(null, [attendance])).toEqual([]);
  });
});

describe("SCRUM-176/AC4 what is already waiting", () => {
  it("176-S8: lists every thing the pending requests change, once each, in a fixed order", () => {
    expect(pendingChangeThings([attendance, start, { ...end, ...attendance }])).toEqual(["expected attendance", "date and time"]);
  });

  it("176-S9: lists nothing when no request is pending", () => {
    expect(pendingChangeThings([])).toEqual([]);
  });
});

describe("SCRUM-176/AC1 the refusal message", () => {
  it("176-S1: names what is waiting and says to ask the coordinator", () => {
    expect(conflictingRequestMessage(["expected attendance"])).toBe(
      "A change to the expected attendance is already waiting for your coordinator. Ask your coordinator about it before requesting another change to it.",
    );
  });

  it("176-S3: lists several things in plain English", () => {
    expect(conflictingRequestMessage(["expected attendance", "date and time", "venue requirements"])).toBe(
      "A change to the expected attendance, date and time and venue requirements is already waiting for your coordinator. Ask your coordinator about it before requesting another change to them.",
    );
  });
});
