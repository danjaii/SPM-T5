import { describe, expect, it } from "vitest";
import { coordinatorClash, totalAttendance, type CoordinatorEventSlot } from "../src/coordinatorClash";

const slot = (over: Partial<CoordinatorEventSlot> = {}): CoordinatorEventSlot => ({
  id: "e-1",
  name: "Tech Summit",
  preferred_start_datetime: "2031-06-15T01:00:00Z",
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 100,
  ...over,
});
const target = { preferred_start_datetime: "2031-06-15T08:00:00Z", preferred_end_datetime: "2031-06-15T12:00:00Z" };

describe("SCRUM-168/AC1 a clash names the overlapping event", () => {
  it("SCRUM-168/AC1 reports the first event whose period overlaps", () => {
    const events = [slot({ id: "early", name: "Early", preferred_end_datetime: "2031-06-15T02:00:00Z" }), slot()];

    expect(coordinatorClash(target, events)).toEqual({ status: "clash", eventId: "e-1", eventName: "Tech Summit" });
  });

  it("SCRUM-168/AC1 treats an event inside the other, or around it, as a clash", () => {
    expect(coordinatorClash(target, [slot({ preferred_start_datetime: "2031-06-15T09:00:00Z", preferred_end_datetime: "2031-06-15T10:00:00Z" })]).status).toBe("clash");
    expect(coordinatorClash(target, [slot({ preferred_start_datetime: "2031-06-15T00:00:00Z", preferred_end_datetime: "2031-06-15T23:00:00Z" })]).status).toBe("clash");
  });

  it("SCRUM-168/AC1 treats an event with no end as an instant at its start", () => {
    expect(coordinatorClash({ ...target, preferred_end_datetime: null }, [slot()])).toEqual({ status: "clash", eventId: "e-1", eventName: "Tech Summit" });
    expect(coordinatorClash(target, [slot({ preferred_start_datetime: "2031-06-15T10:00:00Z", preferred_end_datetime: null })]).status).toBe("clash");
  });
});

describe("SCRUM-168/AC2 free when nothing overlaps", () => {
  it("SCRUM-168/AC2 is free with no events", () => {
    expect(coordinatorClash(target, [])).toEqual({ status: "free" });
  });

  it("SCRUM-168/AC2 is free on the same day when the times do not overlap, including events that only touch", () => {
    expect(coordinatorClash(target, [slot({ preferred_start_datetime: "2031-06-15T12:00:00Z", preferred_end_datetime: "2031-06-15T15:00:00Z" })])).toEqual({ status: "free" });
    expect(coordinatorClash(target, [slot({ preferred_start_datetime: "2031-06-15T04:00:00Z", preferred_end_datetime: "2031-06-15T08:00:00Z" })])).toEqual({ status: "free" });
  });

  it("SCRUM-168/AC2 ignores a coordinator's event with no preferred date", () => {
    expect(coordinatorClash(target, [slot({ preferred_start_datetime: null, preferred_end_datetime: null })])).toEqual({ status: "free" });
  });
});

describe("SCRUM-168/AC5 no date on the event being assigned", () => {
  it("SCRUM-168/AC5 says the date is not set, never free", () => {
    const none = { preferred_start_datetime: null, preferred_end_datetime: null };

    expect(coordinatorClash(none, [slot()])).toEqual({ status: "no_date" });
    expect(coordinatorClash(none, [])).toEqual({ status: "no_date" });
  });
});

describe("SCRUM-168/AC3 total attendance", () => {
  it("SCRUM-168/AC3 adds up expected attendance, counting a missing figure as 0", () => {
    expect(totalAttendance([slot(), slot({ id: "e-2", expected_attendance: 20 }), slot({ id: "e-3", expected_attendance: null })])).toBe(120);
    expect(totalAttendance([])).toBe(0);
  });
});
