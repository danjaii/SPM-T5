import { describe, expect, it } from "vitest";
import { HOLD_WARNING_DEFAULT_MINUTES, HOLD_WARNING_MAX_MINUTES, parseHoldWarningInput } from "../src/holdExpiry";

describe("SCRUM-108/AC1 the warning time a coordinator sets on a hold", () => {
  it("SCRUM-108/AC1 defaults to 24 hours and allows up to 30 days", () => {
    expect(HOLD_WARNING_DEFAULT_MINUTES).toBe(1440);
    expect(HOLD_WARNING_MAX_MINUTES).toBe(43200);
  });

  it.each([1, 60, 1440, 43200])("SCRUM-108/AC1 accepts %i whole minutes", (minutes) => {
    expect(parseHoldWarningInput({ minutes })).toEqual({ ok: true, data: { minutes } });
  });

  it.each([[{}], [{ minutes: 0 }], [{ minutes: -5 }], [{ minutes: 1.5 }], [{ minutes: "60" }], [{ minutes: 43201 }], [null], [[]]])(
    "SCRUM-108/AC1 refuses %j with a message on `minutes`",
    (body) => {
      const parsed = parseHoldWarningInput(body);
      expect(parsed.ok).toBe(false);
      expect(Object.keys((parsed as { fieldErrors: object }).fieldErrors)).toEqual(["minutes"]);
    },
  );
});
