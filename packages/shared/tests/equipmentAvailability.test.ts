import { describe, expect, it } from "vitest";
import { parseAvailabilityInput } from "../src/equipmentAvailability";

// ----------------------------------------------------------------------------
// SCRUM-18 input checks, shared by the web form and equipment-service so both say exactly the same thing.
// ----------------------------------------------------------------------------

// The clock: 2026-10-06 09:00 Singapore time.
const now = new Date("2026-10-06T01:00:00Z");

/** A complete, valid question: 4 Projector Units on 15 Oct 2026, 09:00 to 17:00. */
const valid = { equipmentName: "Projector Unit", quantity: "4", date: "2026-10-15", startTime: "09:00", endTime: "17:00" };

describe("SCRUM-18 parseAvailabilityInput", () => {
  // AC1: a complete question is accepted, and the Singapore period is turned into the times the database uses.
  it("SCRUM-18/AC1: accepts a complete question", () => {
    expect(parseAvailabilityInput(valid, now)).toEqual({
      ok: true,
      data: {
        equipmentName: "Projector Unit",
        quantity: 4,
        date: "2026-10-15",
        startTime: "09:00",
        endTime: "17:00",
        start: new Date("2026-10-15T01:00:00Z"),
        end: new Date("2026-10-15T09:00:00Z"),
      },
    });
  });
  // end of AC1

  // AC4 + AC6 + quantity: every missing field gets its own prompt, all at once.
  it("SCRUM-18/AC4,AC6: prompts for every missing field together", () => {
    expect(parseAvailabilityInput({}, now)).toEqual({
      ok: false,
      fieldErrors: {
        equipmentName: "Please enter the equipment name.",
        quantity: "Please enter the quantity required.",
        date: "Please enter a date.",
        startTime: "Please enter a start time.",
        endTime: "Please enter an end time.",
      },
    });
  });

  it("SCRUM-18/AC4: removes spaces around the name, and treats a name of only spaces as missing", () => {
    const trimmed = parseAvailabilityInput({ ...valid, equipmentName: "  Projector Unit  " }, now);
    expect(trimmed.ok && trimmed.data.equipmentName).toBe("Projector Unit");
    expect(parseAvailabilityInput({ ...valid, equipmentName: "   " }, now)).toEqual({
      ok: false,
      fieldErrors: { equipmentName: "Please enter the equipment name." },
    });
  });
  // end of AC4, AC6

  // Quantity: a whole number of at least 1.
  it.each(["0", "-2", "2.5", "abc"])("SCRUM-18: refuses a quantity of %s", (quantity) => {
    expect(parseAvailabilityInput({ ...valid, quantity }, now)).toEqual({
      ok: false,
      fieldErrors: { quantity: "Please enter a whole number of at least 1." },
    });
  });
  // end of quantity

  // AC7: filled in, but wrong.
  it("SCRUM-18/AC7: refuses a malformed or impossible date and a malformed time", () => {
    expect(parseAvailabilityInput({ ...valid, date: "15/10/2026" }, now)).toEqual({
      ok: false,
      fieldErrors: { date: "Please enter the date as YYYY-MM-DD." },
    });
    expect(parseAvailabilityInput({ ...valid, date: "2026-02-30" }, now)).toEqual({
      ok: false,
      fieldErrors: { date: "Please enter a real date." },
    });
    expect(parseAvailabilityInput({ ...valid, startTime: "9am", endTime: "25:00" }, now)).toEqual({
      ok: false,
      fieldErrors: { startTime: "Please enter the start time as HH:MM.", endTime: "Please enter the end time as HH:MM." },
    });
  });

  it("SCRUM-18/AC7: refuses an end time that is not after the start time, and a period in the past", () => {
    expect(parseAvailabilityInput({ ...valid, startTime: "17:00", endTime: "09:00" }, now)).toEqual({
      ok: false,
      fieldErrors: { endTime: "The end time must be after the start time." },
    });
    expect(parseAvailabilityInput({ ...valid, date: "2026-10-01" }, now)).toEqual({
      ok: false,
      fieldErrors: { startTime: "The date and time must not be in the past." },
    });
  });
  // end of AC7
});
// end of SCRUM-18
