import { describe, expect, it } from "vitest";
import {
  LAYOUT_TYPE_NAME_MAX_LENGTH,
  cleanLayoutTypeName,
  layoutTypeInUseMessage,
  parseLayoutTypeInput,
  sameLayoutName,
} from "../../src/layoutType";

describe("SCRUM-181/AC1 the name as it is stored (181-S1)", () => {
  it("181-S1: trims the name and turns every run of white space into one space", () => {
    expect(cleanLayoutTypeName("  Cabaret \t style  ")).toBe("Cabaret style");
    expect(parseLayoutTypeInput({ name: "  Hollow   Square " })).toEqual({ ok: true, data: { name: "Hollow Square" } });
  });

  it("181-S1: accepts a name of exactly the longest length", () => {
    const name = "x".repeat(LAYOUT_TYPE_NAME_MAX_LENGTH);
    expect(parseLayoutTypeInput({ name })).toEqual({ ok: true, data: { name } });
  });
});

describe("SCRUM-181/AC5 empty, too long and duplicate names (181-S5)", () => {
  it.each([
    ["an empty name", { name: "" }],
    ["a blank name", { name: "   \t " }],
    ["no name", {}],
    ["a name that is not text", { name: 7 }],
    ["no body", undefined],
    ["a body that is not an object", "Theatre"],
  ])("181-S5: refuses %s with a message for the name field", (_label, body) => {
    expect(parseLayoutTypeInput(body)).toEqual({ ok: false, fieldErrors: { name: "Enter a name for the layout type." } });
  });

  it("181-S5: refuses a name over the limit and says what the limit is", () => {
    const result = parseLayoutTypeInput({ name: "x".repeat(LAYOUT_TYPE_NAME_MAX_LENGTH + 1) });
    expect(result).toEqual({ ok: false, fieldErrors: { name: "The name can be at most 60 characters." } });
  });

  it("181-S5: counts the length after cleaning, not before", () => {
    const padded = `  ${"x".repeat(LAYOUT_TYPE_NAME_MAX_LENGTH)}  `;
    expect(parseLayoutTypeInput({ name: padded }).ok).toBe(true);
  });

  it("181-S5: sameLayoutName ignores case and spacing, so the page can warn about a duplicate in its own list", () => {
    expect(sameLayoutName("theatre", "Theatre")).toBe(true);
    expect(sameLayoutName("  U-Shape ", "u-shape")).toBe(true);
    expect(sameLayoutName("Hollow  Square", "hollow square")).toBe(true);
    expect(sameLayoutName("Theatre", "Theatre style")).toBe(false);
  });
});

describe("SCRUM-181/AC4 the sentence when a delete is refused (181-S4)", () => {
  it("181-S4: names every venue that uses the type", () => {
    const message = layoutTypeInUseMessage("Theatre", {
      venues: [
        { id: "v1", name: "Marina Bayview Hall A" },
        { id: "v2", name: "Orchard Suite 2" },
      ],
      eventCount: 0,
    });
    expect(message).toBe('"Theatre" cannot be deleted because 2 venues use it: Marina Bayview Hall A, Orchard Suite 2.');
  });

  it("181-S4: uses the singular for one venue", () => {
    expect(layoutTypeInUseMessage("Banquet", { venues: [{ id: "v1", name: "Hall" }], eventCount: 0 })).toBe(
      '"Banquet" cannot be deleted because 1 venue uses it: Hall.',
    );
  });

  it("181-S4: only counts event requests and names none, because Venue Staff may not read them", () => {
    expect(layoutTypeInUseMessage("Classroom", { venues: [], eventCount: 1 })).toBe(
      '"Classroom" cannot be deleted because 1 event request prefers it.',
    );
    expect(layoutTypeInUseMessage("Classroom", { venues: [], eventCount: 3 })).toBe(
      '"Classroom" cannot be deleted because 3 event requests prefer it.',
    );
  });

  it("181-S4: says both when venues and event requests use the type", () => {
    expect(layoutTypeInUseMessage("Boardroom", { venues: [{ id: "v1", name: "Suite" }], eventCount: 2 })).toBe(
      '"Boardroom" cannot be deleted because 1 venue uses it: Suite, and 2 event requests prefer it.',
    );
  });
});

// More cases mutation testing found no test for (SCRUM-187/AC3, docs/testing/mutation-testing.md).
describe("SCRUM-181/AC5 a body that is not an object (181-S5)", () => {
  it("181-S5: a null body asks for the name, not a crash", () => {
    expect(parseLayoutTypeInput(null)).toEqual({ ok: false, fieldErrors: { name: "Enter a name for the layout type." } });
  });
});
