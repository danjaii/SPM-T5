import { describe, expect, it } from "vitest";
import { ROLES } from "../src/roles";
import { canManageVenueCatalogue, parseVenueInput } from "../src/venueCatalogue";

const LAYOUT_A = "e2feef5a-7c9f-5085-a039-39a50f8d03b7";
const LAYOUT_B = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";
const FACILITY = "8a02aa6c-e1ae-59e3-9d09-e5704315347d";

const complete = (extra: Record<string, unknown> = {}) => ({
  name: "Orchid Hall",
  address: "Level 3, 1 Raffles Place",
  description: "A hall for talks.",
  maxCapacity: 150,
  operatingHoursStart: "08:00",
  operatingHoursEnd: "22:00",
  isAccessible: true,
  accessibilityNotes: "Step-free entrance on the east side.",
  layouts: [{ layoutId: LAYOUT_A, maxCapacity: 150 }],
  facilityIds: [FACILITY],
  ...extra,
});

function fieldErrors(body: unknown) {
  const parsed = parseVenueInput(body);
  if (parsed.ok) throw new Error("expected the input to be rejected");
  return parsed.fieldErrors;
}

describe("SCRUM-57/AC3 only Venue Staff manage the venue catalogue (57-S3)", () => {
  it("57-S3: venue staff may, every other role may not", () => {
    for (const role of ROLES) expect(canManageVenueCatalogue(role)).toBe(role === "venue_staff");
  });
});

describe("SCRUM-57/AC1 a complete venue is accepted (57-S1)", () => {
  it("57-S1: returns the cleaned values", () => {
    const parsed = parseVenueInput(complete({ name: "  Orchid Hall  ", maxCapacity: "150" }));
    expect(parsed).toEqual({
      ok: true,
      data: {
        name: "Orchid Hall",
        address: "Level 3, 1 Raffles Place",
        description: "A hall for talks.",
        maxCapacity: 150,
        operatingHoursStart: "08:00",
        operatingHoursEnd: "22:00",
        isAccessible: true,
        accessibilityNotes: "Step-free entrance on the east side.",
        layouts: [{ layoutId: LAYOUT_A, maxCapacity: 150 }],
        facilityIds: [FACILITY],
      },
    });
  });

  it("57-S1: the optional fields may be left out", () => {
    const parsed = parseVenueInput({ name: "Lotus Room", address: "Level 1", maxCapacity: 40, layouts: [{ layoutId: LAYOUT_A, maxCapacity: 40 }] });
    expect(parsed).toEqual({
      ok: true,
      data: {
        name: "Lotus Room",
        address: "Level 1",
        description: null,
        maxCapacity: 40,
        operatingHoursStart: null,
        operatingHoursEnd: null,
        isAccessible: false,
        accessibilityNotes: null,
        layouts: [{ layoutId: LAYOUT_A, maxCapacity: 40 }],
        facilityIds: [],
      },
    });
  });

  it("57-S1: blank optional text counts as left out, and times with seconds are cut to HH:MM", () => {
    const parsed = parseVenueInput(complete({ description: "  ", accessibilityNotes: "", operatingHoursStart: "08:00:00", operatingHoursEnd: "22:30:00" }));
    expect(parsed).toMatchObject({ ok: true, data: { description: null, accessibilityNotes: null, operatingHoursStart: "08:00", operatingHoursEnd: "22:30" } });
  });

  it("57-S1: a layout may seat fewer people than the venue holds, several layouts are fine, and repeated facilities count once", () => {
    const parsed = parseVenueInput(
      complete({
        layouts: [
          { layoutId: LAYOUT_A, maxCapacity: 100 },
          { layoutId: LAYOUT_B, maxCapacity: "150" },
        ],
        facilityIds: [FACILITY, FACILITY],
      }),
    );
    expect(parsed).toMatchObject({
      ok: true,
      data: {
        layouts: [
          { layoutId: LAYOUT_A, maxCapacity: 100 },
          { layoutId: LAYOUT_B, maxCapacity: 150 },
        ],
        facilityIds: [FACILITY],
      },
    });
  });
});

describe("SCRUM-57/AC2 required fields (57-S2)", () => {
  it("57-S2: an empty body names every required field at once", () => {
    expect(Object.keys(fieldErrors({})).sort()).toEqual(["address", "layouts", "maxCapacity", "name"]);
    expect(Object.keys(fieldErrors(undefined)).sort()).toEqual(["address", "layouts", "maxCapacity", "name"]);
  });

  it("57-S2: a blank name or location is missing", () => {
    expect(fieldErrors(complete({ name: "   " }))).toEqual({ name: "Enter the venue's name." });
    expect(fieldErrors(complete({ address: "" }))).toEqual({ address: "Enter the venue's location." });
  });

  it("57-S2: a name over 120 characters or a location over 200 is too long", () => {
    expect(fieldErrors(complete({ name: "x".repeat(121) })).name).toMatch(/120/);
    expect(fieldErrors(complete({ address: "x".repeat(201) })).address).toMatch(/200/);
  });

  it.each([0, -5, 12.5, "abc", "", null, 100001])("57-S2: capacity %j is rejected", (maxCapacity) => {
    expect(fieldErrors(complete({ maxCapacity })).maxCapacity).toBeDefined();
  });

  it("57-S2: at least one layout is required", () => {
    expect(fieldErrors(complete({ layouts: [] })).layouts).toMatch(/at least one/i);
    expect(fieldErrors(complete({ layouts: "theatre" })).layouts).toMatch(/at least one/i);
  });

  it("57-S2: a layout needs an id and a capacity between 1 and the venue's", () => {
    expect(fieldErrors(complete({ layouts: [{ layoutId: "", maxCapacity: 10 }] })).layouts).toBeDefined();
    expect(fieldErrors(complete({ layouts: [{ layoutId: "not-an-id", maxCapacity: 10 }] })).layouts).toBeDefined();
    expect(fieldErrors(complete({ layouts: [{ layoutId: LAYOUT_A, maxCapacity: 0 }] })).layouts).toBeDefined();
    expect(fieldErrors(complete({ layouts: [{ layoutId: LAYOUT_A, maxCapacity: 12.5 }] })).layouts).toBeDefined();
    expect(fieldErrors(complete({ layouts: [{ layoutId: LAYOUT_A, maxCapacity: 151 }] })).layouts).toMatch(/150/);
  });

  it("57-S2: the same layout twice is rejected", () => {
    const layouts = [
      { layoutId: LAYOUT_A, maxCapacity: 100 },
      { layoutId: LAYOUT_A, maxCapacity: 120 },
    ];
    expect(fieldErrors(complete({ layouts })).layouts).toMatch(/once/i);
  });

  it("57-S2: operating hours are both given or both left out, and open before they close", () => {
    expect(fieldErrors(complete({ operatingHoursEnd: undefined }))).toEqual({ operatingHoursEnd: expect.stringMatching(/closing/i) });
    expect(fieldErrors(complete({ operatingHoursStart: "" }))).toEqual({ operatingHoursStart: expect.stringMatching(/opening/i) });
    expect(fieldErrors(complete({ operatingHoursStart: "22:00", operatingHoursEnd: "08:00" })).operatingHoursEnd).toMatch(/after/i);
    expect(fieldErrors(complete({ operatingHoursStart: "09:00", operatingHoursEnd: "09:00" })).operatingHoursEnd).toMatch(/after/i);
    expect(fieldErrors(complete({ operatingHoursStart: "8am" })).operatingHoursStart).toMatch(/HH:MM/);
    expect(fieldErrors(complete({ operatingHoursEnd: "25:00" })).operatingHoursEnd).toMatch(/HH:MM/);
  });

  it("57-S2: facility ids must be ids, and the accessible flag must be yes or no", () => {
    expect(fieldErrors(complete({ facilityIds: ["projector"] })).facilityIds).toBeDefined();
    expect(fieldErrors(complete({ facilityIds: "projector" })).facilityIds).toBeDefined();
    expect(fieldErrors(complete({ isAccessible: "maybe" })).isAccessible).toBeDefined();
  });

  it("57-S2: problems in several fields are all reported together", () => {
    const errors = fieldErrors({ name: "", address: "Level 1", maxCapacity: 0, layouts: [] });
    expect(Object.keys(errors).sort()).toEqual(["layouts", "maxCapacity", "name"]);
  });
});
