import { describe, expect, it } from "vitest";
import { canOpen, ROLE_ONLY_MATCHERS } from "@/lib/roleAccess";

describe("SCRUM-122/AC3 role access", () => {
  it("SCRUM-122/AC3 lets a role open its own home and nobody else's", () => {
    expect(canOpen("venue_staff", "/dashboard/venue_staff")).toBe(true);
    expect(canOpen("venue_staff", "/dashboard/attendee")).toBe(false);
  });

  it("SCRUM-122/AC3 keeps /lead/* for Leads", () => {
    expect(canOpen("event_coordinator_lead", "/lead/queue")).toBe(true);
    expect(canOpen("event_coordinator", "/lead/queue")).toBe(false);
  });

  it.each([
    ["/booking-queue", "venue_staff"],
    ["/booking-queue/abc", "venue_staff"],
    ["/safety-checks", "safety_officer"],
    ["/equipment-requests", "technical_support_staff"],
    ["/equipment-availability", "technical_support_staff"],
    ["/equipment-reservation", "technical_support_staff"],
  ])("SCRUM-122/AC3 %s is only for %s", (path, owner) => {
    expect(canOpen(owner, path)).toBe(true);
    expect(canOpen("attendee", path)).toBe(false);
    expect(canOpen("event_coordinator", path)).toBe(false);
  });

  it("SCRUM-122/AC3 leaves shared pages open", () => {
    expect(canOpen("attendee", "/profile")).toBe(true);
    expect(canOpen("event_coordinator", "/venues")).toBe(true);
    expect(canOpen("attendee", "/booking-queuex")).toBe(true);
  });

  it("SCRUM-122/AC3 gives the route guard a matcher for each role-only route", async () => {
    const { config } = await import("@/middleware");
    expect(ROLE_ONLY_MATCHERS).toHaveLength(5);
    for (const matcher of ROLE_ONLY_MATCHERS) expect(config.matcher).toContain(matcher);
  });
});
