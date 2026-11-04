import { describe, expect, it } from "vitest";
import { paddedPeriod, slotConflictMessage } from "../src/venueOccupancy";
import { sgtToUtc } from "../src/venueBooking";

const at = (time: string, date = "2026-11-14") => sgtToUtc(date, time);
const orchid = { setupMinutes: 30, turnaroundMinutes: 45 };

describe("SCRUM-103/AC1 paddedPeriod, the one definition of a booking's occupied time (103-S1)", () => {
  it("103-S1: adds the setup before and the turnaround after", () => {
    expect(paddedPeriod({ start: at("10:00"), end: at("12:00") }, orchid)).toEqual({ start: at("09:30"), end: at("12:45") });
  });

  it("103-S1: a request at 12:30-14:00 occupies 12:00-14:45", () => {
    expect(paddedPeriod({ start: at("12:30"), end: at("14:00") }, orchid)).toEqual({ start: at("12:00"), end: at("14:45") });
  });

  it("103-S6: zero times leave the period unchanged", () => {
    const period = { start: at("10:00"), end: at("12:00") };
    expect(paddedPeriod(period, { setupMinutes: 0, turnaroundMinutes: 0 })).toEqual(period);
  });

  it("103-S1: padding can cross midnight", () => {
    expect(paddedPeriod({ start: at("00:10"), end: at("23:50") }, orchid)).toEqual({
      start: at("23:40", "2026-11-13"),
      end: at("00:35", "2026-11-15"),
    });
  });
});

describe("SCRUM-103/AC1 slotConflictMessage (103-S1)", () => {
  const occupied = { start: at("09:30"), end: at("12:45") };

  it("103-S1: names the venue and the occupied period, including setup and turnaround", () => {
    expect(slotConflictMessage("Orchid Hall", occupied, orchid)).toBe(
      "Orchid Hall is occupied from 09:30 to 12:45, including setup and turnaround",
    );
  });

  it("103-S6: no suffix when the venue has no setup or turnaround time", () => {
    expect(slotConflictMessage("Lotus Room", { start: at("10:00"), end: at("12:00") }, { setupMinutes: 0, turnaroundMinutes: 0 })).toBe(
      "Lotus Room is occupied from 10:00 to 12:00",
    );
  });

  it("103-S1: the suffix stays when only one of the times is set", () => {
    expect(slotConflictMessage("Orchid Hall", occupied, { setupMinutes: 0, turnaroundMinutes: 15 })).toMatch(/including setup and turnaround$/);
  });

  it("103-S1: a period over midnight shows its dates", () => {
    const overnight = { start: at("23:00"), end: at("01:30", "2026-11-15") };
    expect(slotConflictMessage("Orchid Hall", overnight, orchid)).toBe(
      "Orchid Hall is occupied from 2026-11-14 23:00 to 2026-11-15 01:30, including setup and turnaround",
    );
  });
});

describe("SCRUM-97 Scenario 2: a tentative hold is called tentatively held", () => {
  const period = { start: new Date("2026-11-14T01:30:00Z"), end: new Date("2026-11-14T04:45:00Z") };
  const padded = { setupMinutes: 30, turnaroundMinutes: 45 };

  it("SCRUM-97 says 'tentatively held' when the holder is a tentative hold, with the same period and suffix", () => {
    expect(slotConflictMessage("Orchid Hall", period, padded, true)).toBe(
      "Orchid Hall is tentatively held from 09:30 to 12:45, including setup and turnaround",
    );
    expect(slotConflictMessage("Lotus Room", period, { setupMinutes: 0, turnaroundMinutes: 0 }, true)).toBe("Lotus Room is tentatively held from 09:30 to 12:45");
  });

  it("SCRUM-97 keeps SCRUM-103's 'occupied' for a confirmed holder", () => {
    expect(slotConflictMessage("Orchid Hall", period, padded, false)).toBe("Orchid Hall is occupied from 09:30 to 12:45, including setup and turnaround");
    expect(slotConflictMessage("Orchid Hall", period, padded)).toBe("Orchid Hall is occupied from 09:30 to 12:45, including setup and turnaround");
  });
});
