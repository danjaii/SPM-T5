// SCRUM-130 shared acceptance criteria (the UI redesign's AC4 to AC11, numbered as on the ticket): the shared shell, three clicks,
// status as icon and words, contrast from tokens, 375 px, keyboard, empty/loading/error states, and tokens and shadcn only.
// Contrast and 375 px cannot be measured in jsdom, so they are checked as the classes and tokens that produce them; the browser
// check at 375 px and 1280 px is in the PR.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { VenueCalendarLegend } from "@/components/venue-calendar/VenueCalendarLegend";
import { VenueDayView } from "@/components/venue-calendar/VenueDayTimeline";
import { VenueMonthGrid } from "@/components/venue-calendar/VenueMonthGrid";
import { VenueWeekGrid } from "@/components/venue-calendar/VenueWeekGrid";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { NAV_ITEMS } from "@/lib/nav";
import { calendarFixture, jsonReply, venueFixture } from "./venue-calendar-fixtures";

const NOW = new Date("2026-11-14T02:15:00.000Z");
afterEach(() => vi.unstubAllGlobals());

const DIR = resolve(__dirname, "../../src/components/venue-calendar");
const sources = readdirSync(DIR).filter((f) => f.endsWith(".tsx")).map((f) => [f, readFileSync(resolve(DIR, f), "utf8")] as const);
const PAGE = readFileSync(resolve(__dirname, "../../src/app/venue-calendar/page.tsx"), "utf8");
const LIB = readFileSync(resolve(__dirname, "../../src/lib/venueTimeline.ts"), "utf8");

const periods = [
  { kind: "event", status: "CONFIRMED", label: "Confirmed", start: "2026-11-14T02:00:00.000Z", end: "2026-11-14T04:00:00.000Z" },
  { kind: "event", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: "2026-11-14T05:00:00.000Z", end: "2026-11-14T06:00:00.000Z" },
  { kind: "block", status: "BLOCKED", label: "Blocked", start: "2026-11-14T07:00:00.000Z", end: "2026-11-14T09:00:00.000Z", reason_label: "Maintenance" },
  { kind: "closed", status: "UNAVAILABLE", label: "Unavailable", start: "2026-11-14T10:00:00.000Z", end: "2026-11-14T12:00:00.000Z" },
];
const venue = venueFixture({ periods }) as unknown as CalendarVenue;

describe("SCRUM-130/AC4 the shared app shell", () => {
  it("SCRUM-130/AC4 is in the sidebar of every role that may open it, and the page adds no chrome of its own", () => {
    for (const role of ["venue_staff", "event_coordinator", "technical_support_staff"] as const) {
      expect(NAV_ITEMS[role].some((item) => item.href === "/venue-calendar")).toBe(true);
    }
    expect(PAGE).toContain("className={PAGE_MAIN}");
    expect(PAGE).not.toMatch(/<header|<nav|<aside/);
  });
});

describe("SCRUM-130/AC5 three clicks to the main task", () => {
  it("SCRUM-130/AC5 reaches Mark venue unavailable in two clicks from the Venue Staff home: the sidebar item, then the button", async () => {
    expect(NAV_ITEMS.venue_staff.find((item) => item.href === "/venue-calendar")?.label).toBe("Venue calendar");
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture())));
    render(<VenueCalendar canMarkUnavailable now={NOW} />);
    await screen.findByText("Orchid Hall");
    expect(screen.getByRole("button", { name: "Mark venue unavailable" })).toBeTruthy();
  });
});

describe("SCRUM-130/AC6 status is an icon and words, never colour alone", () => {
  it("SCRUM-130/AC6 every booked, held, blocked and closed block on the day view has its icon and its words", () => {
    render(<VenueDayView venues={[venue]} date="2026-11-14" />);
    for (const [kind, words] of [["event", "Confirmed"], ["block", "Blocked: Maintenance"], ["closed", "Unavailable"]]) {
      const el = document.querySelector(`[data-block][data-kind="${kind}"]`) as HTMLElement;
      expect(el.textContent).toContain(words);
      expect(el.querySelector("svg")).not.toBeNull();
    }
    expect(document.querySelectorAll('[data-block][data-kind="event"]')[1].textContent).toContain("Tentatively Held");
  });

  it("SCRUM-130/AC6 the legend names every look with an icon or a pattern beside the words", () => {
    render(<VenueCalendarLegend />);
    const items = screen.getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Confirmed", "Tentatively Held", "Blocked", "Unavailable", "Setup / turnaround", "Conflict"]);
    for (const li of items) expect(li.querySelector("svg, [data-swatch]")).not.toBeNull();
  });

  it("SCRUM-130/AC6 no status uses the primary action colour", () => {
    const look = sources.find(([f]) => f === "VenueCalendarPeriod.tsx")![1];
    expect(look).not.toMatch(/bg-primary|text-primary\b/);
  });
});

describe("SCRUM-130/AC7 contrast comes from the theme's token pairs", () => {
  it("SCRUM-130/AC7 colours each status through a status token pair whose contrast the theme sets", () => {
    const look = sources.find(([f]) => f === "VenueCalendarPeriod.tsx")![1];
    for (const token of ["status-info", "status-success", "status-neutral", "status-danger"]) {
      expect(look).toContain(`bg-${token} text-${token}-fg`);
    }
  });
});

describe("SCRUM-130/AC8 a 375 px screen", () => {
  it("SCRUM-130/AC8 lets the timeline and grids scroll sideways inside their own box, so the page itself never does", () => {
    for (const file of ["VenueDayTimeline.tsx", "VenueWeekGrid.tsx", "VenueMonthGrid.tsx"]) {
      const source = sources.find(([f]) => f === file)![1];
      expect(source).toContain('className="overflow-x-auto rounded-lg border');
    }
  });

  it("SCRUM-130/AC8 lets the toolbars, legend and details wrap or stack", () => {
    const get = (file: string) => sources.find(([f]) => f === file)![1];
    expect(get("VenueCalendarToolbar.tsx")).toContain("flex-wrap");
    expect(get("VenueCalendarLegend.tsx")).toContain("flex-wrap");
    expect(get("VenueCalendar.tsx")).toContain("flex-wrap");
    expect(get("VenueCalendarDetails.tsx")).toContain("break-words"); // a long value wraps inside the popover
  });
});

describe("SCRUM-130/AC9 keyboard", () => {
  it("SCRUM-130/AC9 makes the scrolling timeline and grid reachable by Tab, and every block and cell a button with a focus ring", () => {
    const { unmount } = render(<VenueDayView venues={[venue]} date="2026-11-14" />);
    expect(screen.getByRole("region", { name: "Venue timeline for 2026-11-14" }).tabIndex).toBe(0);
    for (const button of screen.getAllByRole("button")) {
      expect(button.tabIndex).toBeGreaterThanOrEqual(0);
      expect(button.className).toMatch(/focus-visible:ring/);
    }
    unmount();
    const week = render(<VenueWeekGrid venues={[venue]} from="2026-11-09" to="2026-11-15" today="2026-11-14" onOpenDay={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Venue week from 2026-11-09 to 2026-11-15" }).tabIndex).toBe(0);
    for (const button of screen.getAllByRole("button")) expect(button.className).toMatch(/focus-visible:ring/);
    week.unmount();
    render(<VenueMonthGrid venues={[venue]} from="2026-11-01" to="2026-11-30" today="2026-11-14" onOpenDay={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Venue month from 2026-11-01 to 2026-11-30" }).tabIndex).toBe(0);
    for (const button of screen.getAllByRole("button")) expect(button.className).toMatch(/focus-visible:ring/);
  });
});

describe("SCRUM-130/AC10 empty, loading and error states", () => {
  it("SCRUM-130/AC10 says so when there are no venues", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ venues: [] }))));
    render(<VenueCalendar now={NOW} />);
    expect(await screen.findByText("There are no venues to show.")).toBeTruthy();
  });

  it("SCRUM-130/AC10 shows a loading state while the calendar loads", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<VenueCalendar now={NOW} />);
    expect(screen.getByRole("status", { name: "Loading the venue calendar" })).toBeTruthy();
  });

  it("SCRUM-130/AC10 shows an error, not an empty calendar, when the service fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(500, { error: "Something went wrong. Please try again." })));
    render(<VenueCalendar now={NOW} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Something went wrong");
    expect(screen.queryByText("There are no venues to show.")).toBeNull();
  });
});

describe("SCRUM-130/AC11 theme tokens and shadcn components only", () => {
  it.each([...sources, ["venueTimeline.ts", LIB] as const])("SCRUM-130/AC11 %s has no hard-coded colour and no arbitrary value", (_file, source) => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b[a-z-]+-\[[^\]]+\]/);
  });

  it("SCRUM-130/AC11 builds its controls from the shadcn components in components/ui", () => {
    const all = sources.map(([, s]) => s).join("\n");
    for (const ui of ["button", "tabs", "dialog", "alert", "skeleton", "popover", "status-badge"]) expect(all).toContain(`@/components/ui/${ui}`);
  });
});
