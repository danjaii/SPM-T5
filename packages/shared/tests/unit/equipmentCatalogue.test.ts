import { describe, expect, it } from "vitest";
import { ROLES } from "../../src/roles";
import {
  EQUIPMENT_DESCRIPTION_MAX_LENGTH,
  EQUIPMENT_LOCATION_MAX_LENGTH,
  EQUIPMENT_NAME_MAX_LENGTH,
  EQUIPMENT_OPERATIONAL_STATUSES,
  EQUIPMENT_OPERATIONAL_STATUS_LABELS,
  EQUIPMENT_QUANTITY_MAX,
  EQUIPMENT_TYPE_MAX_LENGTH,
  canManageEquipmentCatalogue,
  cleanEquipmentText,
  isEquipmentOperationalStatus,
  parseEquipmentInput,
} from "../../src/equipmentCatalogue";

const complete = (extra: Record<string, unknown> = {}) => ({
  name: "Projector Unit",
  type: "AV",
  description: "1080p ceiling projector.",
  totalQuantity: 10,
  location: "Central Equipment Store",
  ...extra,
});

describe("SCRUM-182/AC1 an item as it is stored (182-S1)", () => {
  it("182-S1: trims every text field, collapses runs of spaces and starts a new item available", () => {
    const parsed = parseEquipmentInput(complete({ name: "  Wireless   Mic  ", type: " Audio ", totalQuantity: " 4 " }));

    expect(parsed).toEqual({
      ok: true,
      data: {
        name: "Wireless Mic",
        type: "Audio",
        description: "1080p ceiling projector.",
        totalQuantity: 4,
        location: "Central Equipment Store",
        operationalStatus: "available",
      },
    });
  });

  it("182-S1: only the required fields are enough; the optional ones become null", () => {
    const parsed = parseEquipmentInput({ name: "Cable Reel", totalQuantity: "25" });

    expect(parsed).toEqual({
      ok: true,
      data: { name: "Cable Reel", type: null, description: null, totalQuantity: 25, location: null, operationalStatus: "available" },
    });
  });

  it("182-S1: blank optional fields are null, not empty text", () => {
    const parsed = parseEquipmentInput(complete({ type: "  ", description: "", location: "\t" }));

    expect(parsed).toMatchObject({ ok: true, data: { type: null, description: null, location: null } });
  });

  it("182-S1: accepts a quantity given as a number, and the limits themselves", () => {
    expect(parseEquipmentInput(complete({ totalQuantity: 1 })).ok).toBe(true);
    expect(parseEquipmentInput(complete({ totalQuantity: EQUIPMENT_QUANTITY_MAX })).ok).toBe(true);
    expect(parseEquipmentInput(complete({ name: "x".repeat(EQUIPMENT_NAME_MAX_LENGTH) })).ok).toBe(true);
  });
});

describe("SCRUM-182/AC2,AC3 an edit keeps or changes the status (182-S2, S3)", () => {
  it("182-S3: every operational status is accepted on an edit, and the page's own labels cover each of them", () => {
    for (const status of EQUIPMENT_OPERATIONAL_STATUSES) {
      expect(parseEquipmentInput(complete({ operationalStatus: status }), "edit")).toMatchObject({ ok: true, data: { operationalStatus: status } });
      expect(EQUIPMENT_OPERATIONAL_STATUS_LABELS[status]).toMatch(/\S/);
      expect(isEquipmentOperationalStatus(status)).toBe(true);
    }
  });

  it("182-S1: a new item always starts available, whatever status the body names", () => {
    expect(parseEquipmentInput(complete({ operationalStatus: "retired" }))).toMatchObject({ ok: true, data: { operationalStatus: "available" } });
    expect(parseEquipmentInput(complete({ operationalStatus: "retired" }), "add")).toMatchObject({ ok: true, data: { operationalStatus: "available" } });
  });

  it("182-S2: an edit that leaves the status out is refused, so it can never put a damaged item back in service by accident", () => {
    for (const body of [complete(), complete({ operationalStatus: "" }), complete({ operationalStatus: null })]) {
      expect(parseEquipmentInput(body, "edit")).toEqual({
        ok: false,
        fieldErrors: { operationalStatus: "Choose one of the listed statuses." },
      });
    }
  });

  it("182-S3: an unknown status is refused on its own field", () => {
    expect(parseEquipmentInput(complete({ operationalStatus: "broken" }), "edit")).toEqual({
      ok: false,
      fieldErrors: { operationalStatus: "Choose one of the listed statuses." },
    });
    expect(isEquipmentOperationalStatus(7)).toBe(false);
  });
});

describe("SCRUM-182/AC4 required and invalid fields (182-S4)", () => {
  it("182-S4: an empty body names every required field", () => {
    expect(parseEquipmentInput({})).toEqual({
      ok: false,
      fieldErrors: { name: "Enter the equipment's name.", totalQuantity: `Quantity must be a whole number from 1 to ${EQUIPMENT_QUANTITY_MAX}.` },
    });
    expect(parseEquipmentInput(undefined).ok).toBe(false);
    expect(parseEquipmentInput("Projector").ok).toBe(false);
  });

  it.each([
    ["a blank name", { name: "   " }, "name"],
    ["a name that is not text", { name: 5 }, "name"],
    ["a name over the limit", { name: "x".repeat(EQUIPMENT_NAME_MAX_LENGTH + 1) }, "name"],
    ["a type over the limit", { type: "x".repeat(EQUIPMENT_TYPE_MAX_LENGTH + 1) }, "type"],
    ["a description over the limit", { description: "x".repeat(EQUIPMENT_DESCRIPTION_MAX_LENGTH + 1) }, "description"],
    ["a location over the limit", { location: "x".repeat(EQUIPMENT_LOCATION_MAX_LENGTH + 1) }, "location"],
    ["a quantity of zero", { totalQuantity: 0 }, "totalQuantity"],
    ["a negative quantity", { totalQuantity: "-3" }, "totalQuantity"],
    ["a fractional quantity", { totalQuantity: "2.5" }, "totalQuantity"],
    ["a quantity in words", { totalQuantity: "ten" }, "totalQuantity"],
    ["a quantity over the limit", { totalQuantity: EQUIPMENT_QUANTITY_MAX + 1 }, "totalQuantity"],
    ["a missing quantity", { totalQuantity: undefined }, "totalQuantity"],
  ])("182-S4: %s is refused on the %s field and nothing else", (_label, extra, field) => {
    const parsed = parseEquipmentInput(complete(extra));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(Object.keys(parsed.fieldErrors)).toEqual([field]);
  });

  it("182-S4: every refused field is named at once, not one at a time", () => {
    const parsed = parseEquipmentInput({ name: "", totalQuantity: "x", type: "x".repeat(61), operationalStatus: "nope" }, "edit");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(Object.keys(parsed.fieldErrors).sort()).toEqual(["name", "operationalStatus", "totalQuantity", "type"]);
  });

  it("182-S4: the length is counted after cleaning, not before", () => {
    expect(parseEquipmentInput(complete({ name: `  ${"x".repeat(EQUIPMENT_NAME_MAX_LENGTH)}  ` })).ok).toBe(true);
    expect(cleanEquipmentText("  a \t b\n c ")).toBe("a b c");
  });
});

describe("SCRUM-182/AC5 only Technical Support Staff (182-S5)", () => {
  it("182-S5: technical support staff may manage the catalogue and every other role may not", () => {
    for (const role of ROLES) {
      expect(canManageEquipmentCatalogue(role)).toBe(role === "technical_support_staff");
    }
  });
});
