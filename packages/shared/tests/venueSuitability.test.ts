import { describe, expect, it } from "vitest";
import {
  checkSuitability,
  isOpenDuring,
  sgtToUtc,
  type SuitabilityRequirements,
  type SuitabilityVenue,
} from "../src";

// SCRUM-109 (docs/specs/venue-suitability.md): the shared suitability check. Pure, so no fakes are needed.

const orchid: SuitabilityVenue = {
  name: "Orchid Hall",
  maxCapacity: 200,
  openingTime: "08:00",
  closingTime: "22:00",
  isAccessible: true,
  accessibilityNotes: "Step-free entrance",
  layouts: [
    { name: "Theatre", maxCapacity: 180 },
    { name: "Classroom", maxCapacity: 100 },
  ],
};
const lotus: SuitabilityVenue = {
  name: "Lotus Room",
  maxCapacity: 60,
  openingTime: "08:00",
  closingTime: "22:00",
  isAccessible: false,
  accessibilityNotes: null,
  layouts: [{ name: "Boardroom", maxCapacity: 20 }],
};

const techConf = (over: Partial<SuitabilityRequirements> = {}): SuitabilityRequirements => ({
  attendance: 120,
  layoutName: "Theatre",
  accessibilityNeeds: null,
  start: sgtToUtc("2026-11-14", "09:00"),
  end: sgtToUtc("2026-11-14", "12:00"),
  ...over,
});

const free = { conflict: null };
const byKey = (report: ReturnType<typeof checkSuitability>, key: string) => report.criteria.find((c) => c.key === key)!;

describe("SCRUM-109/AC1 a venue that meets every requirement (109-S1)", () => {
  it("109-S1: Orchid Hall is Suitable and each stated requirement is met", () => {
    const report = checkSuitability(orchid, techConf(), free);
    expect(report.overall).toBe("suitable");
    expect(report.criteria.map((c) => c.key)).toEqual([
      "capacity",
      "layout",
      "accessibility",
      "facilities",
      "operatingHours",
      "availability",
    ]);
    for (const key of ["capacity", "layout", "operatingHours", "availability"]) {
      expect(byKey(report, key).status).toBe("met");
    }
  });

  it("109-S1: facilities are never checked, and a stated accessibility need is left for a person", () => {
    const report = checkSuitability(orchid, techConf({ accessibilityNeeds: "Step-free access" }), free);
    expect(byKey(report, "facilities")).toMatchObject({ status: "not_checked", message: "Not specified – not checked" });
    expect(byKey(report, "accessibility").status).toBe("manual");
    expect(byKey(report, "accessibility").message).toContain("Check manually: Step-free access");
    expect(report.overall).toBe("suitable");
  });
});

describe("SCRUM-109/AC2 not enough capacity (109-S2, 109-S8)", () => {
  it("109-S2: Lotus Room (60) against 120 attendees is Not suitable with the exact message", () => {
    const report = checkSuitability(lotus, techConf({ layoutName: null }), free);
    expect(report.overall).toBe("not_suitable");
    expect(byKey(report, "capacity")).toMatchObject({
      status: "not_met",
      message: "Expected attendance 120 exceeds capacity 60",
    });
  });

  it("109-S8: attendance equal to capacity fits", () => {
    expect(byKey(checkSuitability(lotus, techConf({ attendance: 60, layoutName: null }), free), "capacity").status).toBe("met");
  });

  it("109-S8: the layout's own capacity is used when the venue supports the layout", () => {
    const report = checkSuitability(orchid, techConf({ attendance: 190, layoutName: "Theatre" }), free);
    expect(byKey(report, "capacity")).toMatchObject({
      status: "not_met",
      message: "Expected attendance 190 exceeds capacity 180",
    });
  });

  it("109-S8: the explicit attendance is what is compared (the seam for per-booking attendance)", () => {
    expect(byKey(checkSuitability(lotus, techConf({ attendance: 40, layoutName: null }), free), "capacity").status).toBe("met");
  });
});

describe("SCRUM-109/AC3 several requirements not met are all listed (109-S3)", () => {
  it("109-S3: capacity and layout are both not met; facilities are never reported as unavailable", () => {
    const report = checkSuitability(lotus, techConf(), free);
    expect(report.overall).toBe("not_suitable");
    expect(byKey(report, "capacity").status).toBe("not_met");
    expect(byKey(report, "layout")).toMatchObject({ status: "not_met", message: "Theatre not supported" });
    expect(byKey(report, "facilities").status).toBe("not_checked");
    expect(report.criteria.filter((c) => c.status === "not_met").map((c) => c.key)).toEqual(["capacity", "layout"]);
  });

  it("109-S3: the layout name is matched ignoring case", () => {
    expect(byKey(checkSuitability(orchid, techConf({ layoutName: "theatre" }), free), "layout").status).toBe("met");
  });
});

describe("SCRUM-109/AC4 the venue is not available (109-S4)", () => {
  const conflict = { start: sgtToUtc("2026-11-14", "13:00"), end: sgtToUtc("2026-11-14", "18:00"), exact: true };

  it("109-S4: a clash makes availability not met and names the conflicting period", () => {
    const report = checkSuitability(orchid, techConf({ end: sgtToUtc("2026-11-14", "14:00") }), { conflict });
    expect(report.overall).toBe("not_suitable");
    expect(byKey(report, "availability").status).toBe("not_met");
    expect(byKey(report, "availability").message).toBe("Occupied on 2026-11-14 from 13:00 to 18:00");
  });

  it("109-S4: a clash whose exact period is unknown still says it is held", () => {
    const report = checkSuitability(orchid, techConf(), { conflict: { start: conflict.start, end: conflict.end, exact: false } });
    expect(byKey(report, "availability")).toMatchObject({
      status: "not_met",
      message: "Already held for part of the requested period",
    });
  });

  it("109-S4: no clash is met", () => {
    expect(byKey(checkSuitability(orchid, techConf(), free), "availability").status).toBe("met");
  });
});

describe("SCRUM-109/AC5 outside operating hours (109-S5, 109-S10)", () => {
  it("109-S5: a 07:00 start is before the 08:00 opening", () => {
    const report = checkSuitability(orchid, techConf({ start: sgtToUtc("2026-11-14", "07:00") }), free);
    expect(report.overall).toBe("not_suitable");
    expect(byKey(report, "operatingHours")).toMatchObject({
      status: "not_met",
      message: "Open 08:00–22:00, the event runs 07:00–12:00",
    });
  });

  it("109-S5: ending after closing is not met", () => {
    const report = checkSuitability(orchid, techConf({ end: sgtToUtc("2026-11-14", "22:30") }), free);
    expect(byKey(report, "operatingHours").status).toBe("not_met");
  });

  it("109-S5: opening and closing exactly at the edges is met", () => {
    const edges = techConf({ start: sgtToUtc("2026-11-14", "08:00"), end: sgtToUtc("2026-11-14", "22:00") });
    expect(byKey(checkSuitability(orchid, edges, free), "operatingHours").status).toBe("met");
  });

  it("109-S5: a venue with no stated hours is always open", () => {
    const anytime = { ...orchid, openingTime: null, closingTime: null };
    const early = techConf({ start: sgtToUtc("2026-11-14", "03:00") });
    expect(byKey(checkSuitability(anytime, early, free), "operatingHours").status).toBe("met");
  });

  it("109-S10: isOpenDuring reads a 00:00 closing time as midnight", () => {
    expect(isOpenDuring("08:00", "00:00", "20:00", "23:59")).toBe(true);
    expect(isOpenDuring("08:00", "22:00", "20:00", "23:00")).toBe(false);
    expect(isOpenDuring(null, null, "03:00", "04:00")).toBe(true);
    expect(isOpenDuring("08:00", "22:00", "07:59", "10:00")).toBe(false);
  });
});

describe("SCRUM-109/AC6 requirements the organiser did not give are not checked (109-S6)", () => {
  it("109-S6: no layout preference is not checked and does not make the venue unsuitable", () => {
    const report = checkSuitability(orchid, techConf({ layoutName: null }), free);
    expect(byKey(report, "layout")).toMatchObject({ status: "not_checked", message: "Not specified – not checked" });
    expect(report.overall).toBe("suitable");
  });

  it("109-S6: no attendance, or no period, is not checked", () => {
    const report = checkSuitability(orchid, techConf({ attendance: null, start: null, end: null }), null);
    expect(byKey(report, "capacity").status).toBe("not_checked");
    expect(byKey(report, "operatingHours").status).toBe("not_checked");
    expect(byKey(report, "availability").status).toBe("not_checked");
    expect(report.overall).toBe("suitable");
  });

  it("109-S6: the free-text note appears under Check manually", () => {
    const report = checkSuitability(orchid, techConf({ layoutName: null, accessibilityNeeds: "Stage must face the windows" }), free);
    expect(report.manualChecks).toEqual(["Stage must face the windows"]);
    expect(byKey(report, "accessibility").status).toBe("manual");
  });

  it("109-S6: a blank note is nothing to check", () => {
    const report = checkSuitability(orchid, techConf({ accessibilityNeeds: "   " }), free);
    expect(report.manualChecks).toEqual([]);
    expect(byKey(report, "accessibility").status).toBe("not_checked");
  });
});
