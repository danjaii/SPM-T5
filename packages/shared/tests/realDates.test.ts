import { describe, expect, it } from "vitest";
import {
  isRealDate,
  parseEventChangeRequestInput,
  parseEventDetailsInput,
  parseRejectionInput,
  parseTechnicalAssignmentInput,
  parseVenueBookingInput,
  type CurrentEventDetails,
} from "../src";

// SCRUM-190: JavaScript rolls a date that does not exist into the next month (31 February 2031 becomes 3 March), so these
// rules used to save a day nobody chose. Each now refuses it on that date's field.

const NOW = new Date("2026-10-01T00:00:00.000Z");

const event: CurrentEventDetails = {
  name: "Tech Summit",
  description: null,
  purpose: null,
  event_category_id: null,
  preferred_start_datetime: "2031-03-10T01:00:00.000Z",
  preferred_end_datetime: "2031-03-10T09:00:00.000Z",
  expected_attendance: 120,
  preferred_room_layout_id: null,
  accessibility_requirements: null,
  venue_requirements: null,
  equipment_requirements_notes: null,
};

describe("SCRUM-190 isRealDate", () => {
  it.each(["2031-03-03", "2032-02-29", "2031-12-31"])("%s exists", (date) => {
    expect(isRealDate(date)).toBe(true);
  });

  it.each(["2031-02-31", "2031-02-29", "2031-04-31", "2031-13-01", "2031-00-10", "soon"])("%s does not exist", (date) => {
    expect(isRealDate(date)).toBe(false);
  });
});

describe("SCRUM-190/AC1 a change request with a date that does not exist", () => {
  const parse = (body: Record<string, unknown>) => parseEventChangeRequestInput(body, event, NOW);

  it("SCRUM-190/AC1: refuses the date, and proposes no change", () => {
    expect(parse({ date: "2031-02-31", startTime: "09:00", endTime: "17:00" })).toEqual({
      ok: false,
      noChanges: false,
      fieldErrors: { date: "Enter a valid date." },
    });
  });

  it("SCRUM-190/AC1: refuses the end date on its own field", () => {
    expect(parse({ date: "2031-02-28", endDate: "2031-02-31", startTime: "09:00", endTime: "17:00" })).toEqual({
      ok: false,
      noChanges: false,
      fieldErrors: { endDate: "Enter a valid end date." },
    });
  });
});

describe("SCRUM-190/AC2 an event edit with a date that does not exist", () => {
  const form = {
    name: "Tech Summit",
    date: "2031-03-10",
    startTime: "09:00",
    endDate: "2031-03-10",
    endTime: "17:00",
    expectedAttendance: 120,
  };
  const parse = (edits: Record<string, unknown>) => parseEventDetailsInput({ ...form, ...edits }, event, NOW);

  it("SCRUM-190/AC2: refuses the start date", () => {
    expect(parse({ date: "2031-02-31", endDate: "2031-03-10" })).toEqual({
      ok: false,
      noChanges: false,
      fieldErrors: { date: "Enter a valid date." },
    });
  });

  it("SCRUM-190/AC2: refuses the end date", () => {
    expect(parse({ date: "2031-02-28", endDate: "2031-02-31" })).toEqual({
      ok: false,
      noChanges: false,
      fieldErrors: { endDate: "Enter a valid end date." },
    });
  });
});

describe("SCRUM-190/AC3 a venue booking request with a date that does not exist", () => {
  const valid = { venueId: "venue-1", startTime: "09:00", endTime: "17:00" };

  it.each(["2031-02-31", "2031-02-29", "2031-04-31"])("SCRUM-190/AC3: refuses %s", (date) => {
    expect(parseVenueBookingInput({ ...valid, date }, NOW)).toEqual({ ok: false, fieldErrors: { date: "Enter a valid date." } });
  });

  it("SCRUM-190/AC3: a rejection's suggestion is still refused on its own field", () => {
    const result = parseRejectionInput({ reason: "Full", suggestion: { ...valid, date: "2031-02-31" } }, NOW);
    expect(result).toEqual({ ok: false, fieldErrors: { "suggestion.date": "Enter a valid date." } });
  });
});

describe("SCRUM-190/AC4 a technical assignment with a date that does not exist", () => {
  const valid = { staffId: "tech-1", venueBookingId: "vb-1", startDate: "2031-03-10", startTime: "08:00", endDate: "2031-03-10", endTime: "17:00" };
  const parse = (edits: Record<string, unknown>) => parseTechnicalAssignmentInput({ ...valid, ...edits }, { requireStaff: true });

  it("SCRUM-190/AC4: refuses the start date", () => {
    expect(parse({ startDate: "2031-02-31" })).toEqual({ ok: false, fieldErrors: { startDate: "Enter a valid date." } });
  });

  it("SCRUM-190/AC4: refuses the end date", () => {
    expect(parse({ endDate: "2031-02-31" })).toEqual({ ok: false, fieldErrors: { endDate: "Enter a valid date." } });
  });

  it("SCRUM-190/AC4: a month that does not exist is refused, not a crash", () => {
    expect(parse({ startDate: "2031-13-01", endDate: "2031-13-02" })).toEqual({
      ok: false,
      fieldErrors: { startDate: "Enter a valid date.", endDate: "Enter a valid date." },
    });
  });
});

describe("SCRUM-190/AC5 real dates are accepted as before", () => {
  // 2032 is a leap year
  const leapDay = "2032-02-29";

  it("SCRUM-190/AC5: a change request accepts 29 February in a leap year", () => {
    expect(parseEventChangeRequestInput({ date: leapDay, startTime: "09:00", endTime: "17:00" }, event, NOW).ok).toBe(true);
  });

  it("SCRUM-190/AC5: an event edit accepts it", () => {
    const form = { name: "Tech Summit", date: leapDay, startTime: "09:00", endDate: leapDay, endTime: "17:00", expectedAttendance: 120 };
    expect(parseEventDetailsInput(form, event, NOW).ok).toBe(true);
  });

  it("SCRUM-190/AC5: a venue booking request accepts it", () => {
    expect(parseVenueBookingInput({ venueId: "venue-1", date: leapDay, startTime: "09:00", endTime: "17:00" }, NOW).ok).toBe(true);
  });

  it("SCRUM-190/AC5: a technical assignment accepts it", () => {
    const body = { staffId: "tech-1", venueBookingId: "vb-1", startDate: leapDay, startTime: "08:00", endDate: leapDay, endTime: "17:00" };
    expect(parseTechnicalAssignmentInput(body, { requireStaff: true }).ok).toBe(true);
  });
});
