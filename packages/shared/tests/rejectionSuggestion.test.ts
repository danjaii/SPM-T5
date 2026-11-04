import { describe, expect, it } from "vitest";
import { parseRejectionInput, sgtToUtc } from "../src/venueBooking";

// SCRUM-40 (docs/specs/venue-booking-suggestion.md): the optional suggestion in a reject body. The same parser runs in the Reject
// dialog and in venue-service, so they cannot disagree.
const NOW = new Date("2026-10-05T03:00:00.000Z");
const REASON = "Room under renovation";
const suggestion = (over: Record<string, unknown> = {}) => ({ venueId: "venue-2", date: "2030-11-15", startTime: "09:00", endTime: "17:00", ...over });
const parse = (body: unknown) => parseRejectionInput(body, NOW);

describe("SCRUM-40/AC1 a suggestion is read as a venue and a period (40-S1)", () => {
  it("40-S1: returns the venue, the Singapore date and times, and the period as UTC instants", () => {
    const parsed = parse({ reason: REASON, suggestion: suggestion() });

    expect(parsed).toEqual({
      ok: true,
      data: {
        reason: REASON,
        suggestion: {
          venueId: "venue-2",
          date: "2030-11-15",
          startTime: "09:00",
          endTime: "17:00",
          start: sgtToUtc("2030-11-15", "09:00"),
          end: sgtToUtc("2030-11-15", "17:00"),
        },
      },
    });
    expect(sgtToUtc("2030-11-15", "09:00").toISOString()).toBe("2030-11-15T01:00:00.000Z");
  });

  it("40-S1: trims the fields and the reason", () => {
    const parsed = parse({ reason: `  ${REASON}  `, suggestion: suggestion({ venueId: " venue-2 ", date: " 2030-11-15 ", startTime: " 09:00 " }) });

    expect(parsed).toMatchObject({ ok: true, data: { reason: REASON, suggestion: { venueId: "venue-2", date: "2030-11-15", startTime: "09:00" } } });
  });

  it("40-S1: the suggestion may be the same venue at another time, or another venue", () => {
    expect(parse({ reason: REASON, suggestion: suggestion({ venueId: "venue-1" }) }).ok).toBe(true);
    expect(parse({ reason: REASON, suggestion: suggestion({ venueId: "venue-9", date: "2030-12-01" }) }).ok).toBe(true);
  });
});

describe("SCRUM-40/AC2 the suggestion is optional (40-S2)", () => {
  it.each([
    ["left out", { reason: REASON }],
    ["null", { reason: REASON, suggestion: null }],
    ["an empty object", { reason: REASON, suggestion: {} }],
    ["every field blank", { reason: REASON, suggestion: { venueId: "", date: "  ", startTime: null, endTime: undefined } }],
  ])("40-S2: %s is no suggestion, and the reason alone comes back", (_label, body) => {
    expect(parse(body)).toEqual({ ok: true, data: { reason: REASON } });
  });
});

describe("SCRUM-40/AC1 an invalid suggestion is refused on its own field (40-S4)", () => {
  it("40-S4: a venue with no times, and times with no venue, name the missing fields", () => {
    const venueOnly = parse({ reason: REASON, suggestion: { venueId: "venue-2" } });
    const timesOnly = parse({ reason: REASON, suggestion: { date: "2030-11-15", startTime: "09:00", endTime: "17:00" } });

    expect(venueOnly).toEqual({
      ok: false,
      fieldErrors: {
        "suggestion.date": "Enter a date.",
        "suggestion.startTime": "Enter a start time.",
        "suggestion.endTime": "Enter an end time.",
      },
    });
    expect(timesOnly).toEqual({ ok: false, fieldErrors: { "suggestion.venueId": "Choose a venue." } });
  });

  it.each([
    ["a date that is not YYYY-MM-DD", { date: "15/11/2030" }, "suggestion.date", "Enter the date as YYYY-MM-DD."],
    ["a date that does not exist", { date: "2030-02-30" }, "suggestion.date", "Enter a valid date."],
    ["a start time that is not HH:MM", { startTime: "9am" }, "suggestion.startTime", "Enter the start time as HH:MM."],
    ["an end time that is not HH:MM", { endTime: "25:00" }, "suggestion.endTime", "Enter the end time as HH:MM."],
    ["an end that is not after the start", { startTime: "17:00", endTime: "09:00" }, "suggestion.endTime", "End time must be after the start time."],
    ["an end equal to the start", { startTime: "09:00", endTime: "09:00" }, "suggestion.endTime", "End time must be after the start time."],
    ["a start in the past", { date: "2026-10-04" }, "suggestion.startTime", "The start time must not be in the past."],
  ])("40-S4: %s is refused on %s", (_label, over, field, message) => {
    const parsed = parse({ reason: REASON, suggestion: suggestion(over) });

    expect(parsed).toEqual({ ok: false, fieldErrors: { [field]: message } });
  });

  it("40-S4: a form that sends empty fields means the same as one that leaves them out", () => {
    const parsed = parse({ reason: REASON, suggestion: { venueId: "venue-2", date: "", startTime: "  ", endTime: null } });

    expect(parsed).toEqual({
      ok: false,
      fieldErrors: {
        "suggestion.date": "Enter a date.",
        "suggestion.startTime": "Enter a start time.",
        "suggestion.endTime": "Enter an end time.",
      },
    });
  });

  it("40-S4: a suggestion that is not an object has every field missing", () => {
    const parsed = parse({ reason: REASON, suggestion: "Lotus Room" });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(Object.keys(parsed.fieldErrors).sort()).toEqual(["suggestion.date", "suggestion.endTime", "suggestion.startTime", "suggestion.venueId"]);
  });

  it("40-S4: the reason is still checked, and both problems are named together", () => {
    const parsed = parse({ reason: "  ", suggestion: suggestion({ date: "2030-02-30" }) });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(Object.keys(parsed.fieldErrors).sort()).toEqual(["reason", "suggestion.date"]);
  });

  it("40-S4: a good suggestion does not make up for a missing reason", () => {
    expect(parse({ suggestion: suggestion() })).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } });
  });

  it("40-S4: the clock decides what is in the past, and defaults to now when none is given", () => {
    expect(parseRejectionInput({ reason: REASON, suggestion: suggestion() }, new Date("2031-01-01T00:00:00Z")).ok).toBe(false);
    expect(parseRejectionInput({ reason: REASON, suggestion: suggestion({ date: "2099-01-01" }) }).ok).toBe(true);
  });
});
