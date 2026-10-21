import { describe, expect, it } from "vitest";
import { holdCountdown } from "@/lib/holds";

const now = new Date("2030-11-10T12:00:00Z");
const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
const H = 60 * 60 * 1000;

describe("SCRUM-133/AC2, AC3 holdCountdown", () => {
  it("is active more than 24 hours out", () => {
    expect(holdCountdown(at(25 * H), now)).toEqual({ state: "active", remaining: "in 25 hours" });
    expect(holdCountdown(at(72 * H), now)).toEqual({ state: "active", remaining: "in 3 days" });
  });

  it("is expiring within 24 hours, including exactly 24", () => {
    expect(holdCountdown(at(24 * H), now).state).toBe("expiring");
    expect(holdCountdown(at(6 * H), now)).toEqual({ state: "expiring", remaining: "in 6 hours" });
    expect(holdCountdown(at(40 * 60_000), now)).toEqual({ state: "expiring", remaining: "in 40 minutes" });
    expect(holdCountdown(at(60_000), now).remaining).toBe("in 1 minute");
  });

  it("is expired at or after the expiry, and for an unreadable date", () => {
    expect(holdCountdown(at(0), now)).toEqual({ state: "expired", remaining: "expired" });
    expect(holdCountdown(at(-H), now).state).toBe("expired");
    expect(holdCountdown("not a date", now).state).toBe("expired");
  });
});
