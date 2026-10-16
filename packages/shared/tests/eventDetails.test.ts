import { describe, expect, it } from "vitest";
import {
  EVENT_IMPORTANT_FIELDS,
  EVENT_ORDINARY_FIELDS,
  eventDetailsFormValues,
  eventDetailsFromFormValues,
  parseEventDetailsInput,
  type CurrentEventDetails,
} from "../src/eventDetails";

// ----------------------------------------------------------------------------
// Test setup: the event as it is now, and the edit form filled in with exactly those values
// (docs/specs/edit-event-details.md). The event is on Sat 12 Dec 2026, 9am to 5pm Singapore time.
// ----------------------------------------------------------------------------

const NOW = new Date("2026-10-01T00:00:00.000Z");

const current: CurrentEventDetails = {
  name: "Tech Summit",
  description: "Annual summit",
  purpose: "Networking",
  event_category_id: "cat-conference",
  preferred_start_datetime: "2026-12-12T01:00:00.000Z",
  preferred_end_datetime: "2026-12-12T09:00:00.000Z",
  expected_attendance: 120,
  preferred_room_layout_id: "layout-theatre",
  accessibility_requirements: "Wheelchair access",
  venue_requirements: "Stage",
  equipment_requirements_notes: "Two projectors",
};

/** The form as the coordinator sees it before changing anything. */
const unchangedForm = {
  name: "Tech Summit",
  description: "Annual summit",
  purpose: "Networking",
  categoryId: "cat-conference",
  date: "2026-12-12",
  startTime: "09:00",
  endDate: "2026-12-12",
  endTime: "17:00",
  expectedAttendance: 120,
  roomLayoutId: "layout-theatre",
  accessibilityRequirements: "Wheelchair access",
  venueRequirements: "Stage",
  equipmentRequirements: "Two projectors",
};

const parse = (edits: Record<string, unknown>) => parseEventDetailsInput({ ...unchangedForm, ...edits }, current, NOW);

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-111/AC2 which fields are ordinary and which are important
// ----------------------------------------------------------------------------

describe("SCRUM-111/AC2 ordinary and important fields (111-S4, 111-S6)", () => {
  // the brief: "Significant changes, such as date, time, attendance, venue requirements, or equipment requirements, may
  // require existing arrangements to be reviewed again", plus layout and accessibility from the story
  // we want to have the important fileds, which are start and end times, attendance, layout, accessibility, venue requirements, and equipment requirements
  it("111-S6 the important fields are the dates and times, attendance, layout, accessibility, venue and equipment requirements", () => {
    expect([...EVENT_IMPORTANT_FIELDS].sort()).toEqual(
      [
        "accessibility_requirements",
        "equipment_requirements_notes",
        "expected_attendance",
        "preferred_end_datetime",
        "preferred_room_layout_id",
        "preferred_start_datetime",
        "venue_requirements",
      ].sort(),
    );
  });

  it("111-S4 the ordinary fields are the name, description, purpose and category", () => {
    expect([...EVENT_ORDINARY_FIELDS].sort()).toEqual(["description", "event_category_id", "name", "purpose"]);
  });
});

// ----------------------------------------------------------------------------
// SCRUM-111/AC1, AC4 what changed, and whether it is important
// ----------------------------------------------------------------------------

describe("SCRUM-111/AC1, AC4 parseEventDetailsInput: what changed (111-S1, 111-S2, 111-S6, 111-S11, 111-S12)", () => {
  it("111-S1 ordinary changes come back as { from, to } for each changed field, and are not important", () => {
    const result = parse({ name: "  Tech Summit 2026  ", description: "New description", purpose: "Learning", categoryId: "cat-workshop" });

    expect(result).toEqual({
      ok: true,
      data: {
        changes: {
          name: { from: "Tech Summit", to: "Tech Summit 2026" },
          description: { from: "Annual summit", to: "New description" },
          purpose: { from: "Networking", to: "Learning" },
          event_category_id: { from: "cat-conference", to: "cat-workshop" },
        },
        important: false,
      },
    });
  });

  it("111-S2 changing one field returns only that field", () => {
    const result = parse({ purpose: "Learning" });

    expect(result.ok && result.data.changes).toEqual({ purpose: { from: "Networking", to: "Learning" } });
  });

  // each important field on its own makes the change important
  it.each([
    ["the start", { startTime: "10:00" }, "preferred_start_datetime", { from: "2026-12-12T01:00:00.000Z", to: "2026-12-12T02:00:00.000Z" }],
    ["the end", { endTime: "18:00" }, "preferred_end_datetime", { from: "2026-12-12T09:00:00.000Z", to: "2026-12-12T10:00:00.000Z" }],
    ["the attendance", { expectedAttendance: 150 }, "expected_attendance", { from: 120, to: 150 }],
    ["the layout", { roomLayoutId: "layout-banquet" }, "preferred_room_layout_id", { from: "layout-theatre", to: "layout-banquet" }],
    ["accessibility", { accessibilityRequirements: "Hearing loop" }, "accessibility_requirements", { from: "Wheelchair access", to: "Hearing loop" }],
    ["venue requirements", { venueRequirements: "Stage and lift" }, "venue_requirements", { from: "Stage", to: "Stage and lift" }],
    ["equipment requirements", { equipmentRequirements: "" }, "equipment_requirements_notes", { from: "Two projectors", to: null }],
  ])("111-S6 changing %s is an important change", (_name, edits, field, change) => {
    const result = parse(edits);

    expect(result).toEqual({ ok: true, data: { changes: { [field]: change }, important: true } });
  });

  // a new date moves both the start and the end when the event is one day
  it("111-S6 a new date for a one-day event changes both the start and the end", () => {
    const result = parse({ date: "2026-12-19", endDate: "2026-12-19" });

    expect(result.ok && Object.keys(result.data.changes).sort()).toEqual(["preferred_end_datetime", "preferred_start_datetime"]);
  });

  it("111-S6 an ordinary and an important change together are important", () => {
    const result = parse({ name: "Tech Summit 2026", expectedAttendance: 150 });

    expect(result.ok && result.data.important).toBe(true);
  });

  // emptied optional fields are saved as empty (null); a category or layout can be cleared
  it("111-S2 clearing an optional field changes it to null", () => {
    const result = parse({ description: "   ", categoryId: "" });

    expect(result.ok && result.data.changes).toEqual({
      description: { from: "Annual summit", to: null },
      event_category_id: { from: "cat-conference", to: null },
    });
  });

  it("111-S12 nothing different from the event: no changes", () => {
    expect(parse({})).toEqual({ ok: false, noChanges: true, fieldErrors: {} });
    expect(parse({ name: "  Tech Summit  " })).toEqual({ ok: false, noChanges: true, fieldErrors: {} }); // only spaces around it
  });
});

// ----------------------------------------------------------------------------
// SCRUM-111/AC3 required information and valid values
// ----------------------------------------------------------------------------

describe("SCRUM-111/AC3 parseEventDetailsInput: validation (111-S7, 111-S8)", () => {
  it.each([
    ["the name", { name: "   " }, "name", "Enter the event name."],
    ["the date", { date: "" }, "date", "Enter a date."],
    ["the start time", { startTime: "" }, "startTime", "Enter a start time."],
    ["the end date", { endDate: "" }, "endDate", "Enter an end date."],
    ["the end time", { endTime: "" }, "endTime", "Enter an end time."],
    ["the expected attendance", { expectedAttendance: "" }, "expectedAttendance", "Enter the expected attendance."],
  ])("111-S7 %s left empty is refused, with what is required", (_name, edits, field, message) => {
    const result = parse(edits);

    expect(result).toEqual({ ok: false, noChanges: false, fieldErrors: { [field]: message } });
  });

  it("111-S7 several empty required fields are all reported", () => {
    const result = parse({ name: "", expectedAttendance: null, endTime: "" });

    expect(result.ok === false && Object.keys(result.fieldErrors).sort()).toEqual(["endTime", "expectedAttendance", "name"]);
  });

  it.each([0, -5, 2.5, "abc", "12x"])("111-S8 an attendance of %j is refused", (expectedAttendance) => {
    expect(parse({ expectedAttendance })).toEqual({
      ok: false,
      noChanges: false,
      fieldErrors: { expectedAttendance: "Enter the expected attendance as a whole number of 1 or more." },
    });
  });

  it("111-S8 an attendance typed as text digits is accepted", () => {
    expect(parse({ expectedAttendance: " 150 " })).toMatchObject({ ok: true, data: { changes: { expected_attendance: { to: 150 } } } });
  });

  it("111-S8 the end must be after the start", () => {
    expect(parse({ endTime: "09:00" })).toMatchObject({ fieldErrors: { endTime: "End time must be after the start time." } });
    expect(parse({ endDate: "2026-12-11" })).toMatchObject({ fieldErrors: { endDate: "End date must not be before the date." } });
  });

  it("111-S8 dates and times in the wrong form are refused", () => {
    expect(parse({ date: "12/12/2026", startTime: "9am" })).toMatchObject({
      fieldErrors: { date: "Enter the date as YYYY-MM-DD.", startTime: "Enter the start time as HH:MM." },
    });
  });

  // only a start that is being changed is checked against today, so an event that already started can still be edited
  it("111-S8 a changed start in the past is refused, an unchanged past start is not", () => {
    expect(parse({ date: "2026-09-30", endDate: "2026-09-30" })).toMatchObject({ fieldErrors: { date: "The date must not be in the past." } });

    const started = { ...current, preferred_start_datetime: "2026-09-01T01:00:00.000Z", preferred_end_datetime: "2026-12-12T09:00:00.000Z" };
    const result = parseEventDetailsInput({ ...unchangedForm, date: "2026-09-01", name: "Renamed" }, started, NOW);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["name", 200],
    ["description", 2000],
    ["purpose", 2000],
    ["accessibilityRequirements", 2000],
    ["venueRequirements", 2000],
    ["equipmentRequirements", 2000],
  ])("111-S8 %s is limited to %i characters", (field, limit) => {
    expect(parse({ [field]: "x".repeat(limit) }).ok).toBe(true);
    const result = parse({ [field]: "x".repeat(limit + 1) });
    expect(result.ok === false && result.fieldErrors[field]).toMatch(new RegExp(`${limit} characters or fewer`));
  });

  it("111-S8 a body that is not an object is refused, not a crash", () => {
    expect(parseEventDetailsInput(undefined, current, NOW)).toMatchObject({ ok: false, noChanges: false });
  });
});
// ----------------------------------------------------------------------------
// SCRUM-111/AC2 the form's values, both ways
// ----------------------------------------------------------------------------

describe("SCRUM-111/AC2 the edit form's values (111-S4, 111-S10)", () => {
  it("111-S4 the form starts from the event in Singapore time, with empty boxes for what is not set", () => {
    expect(eventDetailsFormValues({ ...current, purpose: null, preferred_room_layout_id: null })).toEqual({ ...unchangedForm, purpose: "", roomLayoutId: "" });
  });

  // the form compares what is typed with what it started from, using the same rules as the service
  it("111-S10 turning the form's starting values back gives the event, so an untouched form has nothing to send", () => {
    const back = eventDetailsFromFormValues(eventDetailsFormValues(current));

    expect(back).toEqual(current);
    expect(parseEventDetailsInput(unchangedForm, back, NOW)).toEqual({ ok: false, noChanges: true, fieldErrors: {} });
  });

  it("111-S10 an event with no dates or attendance yet comes back with them empty", () => {
    const bare = { ...current, preferred_start_datetime: null, preferred_end_datetime: null, expected_attendance: null };

    expect(eventDetailsFromFormValues(eventDetailsFormValues(bare))).toEqual(bare);
  });
});
// end of SCRUM-111
