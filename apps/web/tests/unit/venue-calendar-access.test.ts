// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ROLES } from "@spm-t5/shared";
import { NAV_ITEMS } from "@/lib/nav";
import { canOpen, MULTI_ROLE_MATCHERS } from "@/lib/roleAccess";
import { config, middleware } from "@/middleware";

const ALLOWED = ["event_coordinator", "venue_staff", "technical_support_staff"];
const REFUSED = ROLES.filter((r) => !ALLOWED.includes(r));

describe("SCRUM-84/AC8 who may open the venue availability calendar", () => {
  it.each(ALLOWED)("SCRUM-84/AC8 lets a %s open /venue-calendar", (role) => {
    expect(canOpen(role, "/venue-calendar")).toBe(true);
  });

  it.each(REFUSED)("SCRUM-84/AC8 refuses a %s (including the Lead and the Safety Officer)", (role) => {
    expect(canOpen(role, "/venue-calendar")).toBe(false);
  });

  it("SCRUM-84/AC8 refuses an unknown role and guards what is under the page, not look-alikes", () => {
    expect(canOpen("", "/venue-calendar")).toBe(false);
    expect(canOpen("attendee", "/venue-calendar/x")).toBe(false);
    expect(canOpen("attendee", "/venue-calendarx")).toBe(true);
  });

  it("SCRUM-84/AC8 does not weaken the single-role guards", () => {
    expect(canOpen("venue_staff", "/booking-queue")).toBe(true);
    expect(canOpen("event_coordinator", "/booking-queue")).toBe(false);
    expect(canOpen("technical_support_staff", "/safety-checks")).toBe(false);
  });

  it("SCRUM-84/AC8 gives the route guard a matcher for the page", () => {
    expect(MULTI_ROLE_MATCHERS).toEqual(["/venue-calendar/:path*"]);
    for (const matcher of MULTI_ROLE_MATCHERS) expect(config.matcher).toContain(matcher);
  });

  it.each(ALLOWED)("SCRUM-84/AC8 lists the calendar in the %s's navigation", (role) => {
    expect(NAV_ITEMS[role as keyof typeof NAV_ITEMS].find((i) => i.href === "/venue-calendar")?.label).toBe("Venue calendar");
  });

  it.each(REFUSED)("SCRUM-84/AC8 does not list the calendar for a %s", (role) => {
    expect(NAV_ITEMS[role as keyof typeof NAV_ITEMS].some((i) => i.href === "/venue-calendar")).toBe(false);
  });
});

describe("SCRUM-84/AC8 the route guard", () => {
  afterEach(() => vi.unstubAllGlobals());
  const open = (role: string) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ role }) }));
    return middleware(new NextRequest("http://localhost:3000/venue-calendar", { headers: { cookie: "cs_session=t" } }));
  };

  it("SCRUM-84/AC8 sends a guest to sign in", async () => {
    const res = await middleware(new NextRequest("http://localhost:3000/venue-calendar"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("SCRUM-84/AC8 lets a coordinator through", async () => {
    expect((await open("event_coordinator")).headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["event_coordinator_lead", "safety_officer", "attendee", "event_organiser"])("SCRUM-84/AC8 sends a %s to the access-denied page", async (role) => {
    expect((await open(role)).headers.get("location")).toBe("http://localhost:3000/access-denied");
  });
});
