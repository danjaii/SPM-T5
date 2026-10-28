import { describe, expect, it } from "vitest";
import { parseHoldExpiryInput } from "../../src/holdExpiry";

const NOW = new Date("2026-11-01T04:00:00.000Z");
const EVENT_START = new Date("2026-11-14T02:00:00.000Z");

describe("SCRUM-97/AC1 parseHoldExpiryInput: a hold needs a future expiry", () => {
  it("accepts a future ISO date and time before the event starts", () => {
    expect(parseHoldExpiryInput({ expiresAt: "2026-11-01T09:00:00.000Z" }, NOW, EVENT_START)).toEqual({
      ok: true,
      data: { expiresAt: new Date("2026-11-01T09:00:00.000Z") },
    });
  });

  it.each([[undefined], [null], [""], ["   "]])("refuses a missing expiry (%j)", (value) => {
    const res = parseHoldExpiryInput({ expiresAt: value }, NOW, EVENT_START);
    expect(res).toEqual({ ok: false, fieldErrors: { expiresAt: "An expiry date and time in the future is required." } });
  });

  it.each([["not a date"], [12345], [{}], ["2026-13-45T00:00:00Z"]])("refuses something that is not a date and time (%j)", (value) => {
    const res = parseHoldExpiryInput({ expiresAt: value }, NOW, EVENT_START);
    expect(res.ok).toBe(false);
  });

  it("refuses an expiry in the past, and one that is exactly now", () => {
    for (const at of ["2026-11-01T03:59:59.000Z", NOW.toISOString()]) {
      const res = parseHoldExpiryInput({ expiresAt: at }, NOW, EVENT_START);
      expect(res).toEqual({ ok: false, fieldErrors: { expiresAt: "An expiry date and time in the future is required." } });
    }
  });

  it("refuses an expiry after the event starts, but allows exactly the start", () => {
    expect(parseHoldExpiryInput({ expiresAt: "2026-11-14T02:00:00.001Z" }, NOW, EVENT_START)).toEqual({
      ok: false,
      fieldErrors: { expiresAt: "The expiry must be before the event starts." },
    });
    expect(parseHoldExpiryInput({ expiresAt: EVENT_START.toISOString() }, NOW, EVENT_START).ok).toBe(true);
  });

  it("refuses a body that is not an object", () => {
    for (const body of [null, "x", 5, []]) expect(parseHoldExpiryInput(body, NOW, EVENT_START).ok).toBe(false);
  });
});
