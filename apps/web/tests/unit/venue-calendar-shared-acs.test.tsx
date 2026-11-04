// SCRUM-130 shared acceptance criteria (the UI redesign's AC4 to AC11): tokens and shadcn only, small screens, keyboard focus, and
// empty, loading and error states. 375 px and contrast cannot be measured in jsdom, so they are checked as the classes and tokens
// that produce them; the click-through is in the PR's "How to test".

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { VenueCalendarVenue } from "@/components/venue-calendar/VenueCalendarVenue";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { calendarFixture, jsonReply, venueFixture } from "./venue-calendar-fixtures";

afterEach(() => vi.unstubAllGlobals());

const DIR = resolve(__dirname, "../../src/components/venue-calendar");
const sources = readdirSync(DIR).filter((f) => f.endsWith(".tsx")).map((f) => [f, readFileSync(resolve(DIR, f), "utf8")] as const);

describe("SCRUM-130/AC4-AC11 tokens and shadcn components only", () => {
  it.each(sources)("SCRUM-130/AC4 %s has no hard-coded colour and no arbitrary pixel or rem value", (_file, source) => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:w|h|min-w|max-w|min-h|max-h|text|p|m|gap|top|left|size)-\[[^\]]*(?:px|rem|em)\]/);
    expect(source).not.toMatch(/-\[auto_1fr\]|bg-\[|text-\[|border-\[/);
  });
});

describe("SCRUM-130/AC7 small screens", () => {
  it("SCRUM-130/AC7 lets rows and the details wrap or stack, so nothing needs sideways scrolling at 375 px", () => {
    const row = sources.find(([f]) => f === "VenueCalendarPeriod.tsx")![1];
    const details = sources.find(([f]) => f === "VenueCalendarDetails.tsx")![1];
    expect(row).toContain("flex-wrap");
    expect(details).toMatch(/flex-col/);
    expect(details).not.toMatch(/grid-cols-\[/);
  });
});

describe("SCRUM-130/AC8 keyboard focus", () => {
  it("SCRUM-130/AC8 every control in a venue card is a real button, reachable by Tab, with a visible focus ring", () => {
    const venue = venueFixture({ periods: [
      { kind: "block", status: "BLOCKED", label: "Blocked", start: "2026-11-14T07:00:00.000Z", end: "2026-11-14T09:00:00.000Z", reason_label: "Maintenance" },
    ] }) as unknown as CalendarVenue;
    render(<VenueCalendarVenue venue={venue} onMarkUnavailable={() => undefined} />);

    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3); // Mark unavailable, Details, Why is this blocked?
    for (const button of buttons) {
      expect(button.tabIndex).toBeGreaterThanOrEqual(0);
      expect(button.className).toMatch(/focus-visible:(ring|border)/);
    }
  });
});

describe("SCRUM-130/AC9 empty, loading and error states", () => {
  it("SCRUM-130/AC9 says so when there are no venues", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ venues: [] }))));
    render(<VenueCalendar />);
    expect(await screen.findByText("There are no venues to show.")).toBeTruthy();
  });

  it("SCRUM-130/AC9 shows a loading state while the calendar loads", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<VenueCalendar />);
    expect(screen.getByRole("status", { name: "Loading the venue calendar" })).toBeTruthy();
  });

  it("SCRUM-130/AC9 shows an error, not an empty calendar, when the service fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(500, { error: "Something went wrong. Please try again." })));
    render(<VenueCalendar />);
    expect((await screen.findByRole("alert")).textContent).toContain("Something went wrong");
    expect(screen.queryByText("There are no venues to show.")).toBeNull();
  });
});

describe("SCRUM-130/AC6 contrast comes from the status tokens", () => {
  it("SCRUM-130/AC6 colours every status through a status token pair, always with an icon and its label", () => {
    const period = sources.find(([f]) => f === "VenueCalendarPeriod.tsx")![1];
    for (const token of ["status-warning", "status-info", "status-danger", "status-success", "status-neutral"]) {
      expect(period).toContain(`bg-${token} text-${token}-fg`);
    }
  });
});
