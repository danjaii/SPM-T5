// SCRUM-84/AC2 to AC4 and SCRUM-130/AC1, AC2 on the Figma 09 timeline: every venue a row, the hours across, setup and turnaround
// dashed either side of a booking, a block striped with its reason, and a banner when a block lies over confirmed bookings.
// 14 Nov 2026 in Singapore (UTC+8): 10:00 is 02:00Z.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { VenueDayView } from "@/components/venue-calendar/VenueDayTimeline";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { todaySgt } from "@/lib/venueTimeline";
import { calendarFixture, jsonReply, venueFixture } from "./venue-calendar-fixtures";

const Z = (hhmm: string, day = 14) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, day, h - 8, m)).toISOString();
};
const NOW = new Date(Z("10:15"));

// Opens 08:00, closes 18:00; a confirmed 10:00-12:00 booking with 30 min setup and 45 min turnaround; a held booking 14:00-15:00;
// a Maintenance block 15:30-17:00; closed from 18:00.
const booking = [
  { kind: "open", status: "AVAILABLE", label: "Available", start: Z("08:00"), end: Z("09:30") },
  { kind: "setup", status: "CONFIRMED", label: "Confirmed", start: Z("09:30"), end: Z("10:00") },
  { kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("10:00"), end: Z("12:00"), event_start: Z("10:00"), event_end: Z("12:00"), occupied_start: Z("09:30"), occupied_end: Z("12:45"), setup_minutes: 30, turnaround_minutes: 45 },
  { kind: "turnaround", status: "CONFIRMED", label: "Confirmed", start: Z("12:00"), end: Z("12:45") },
  { kind: "open", status: "AVAILABLE", label: "Available", start: Z("12:45"), end: Z("14:00") },
  { kind: "event", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: Z("14:00"), end: Z("15:00"), occupied_start: Z("14:00"), occupied_end: Z("15:00") },
  { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("15:30"), end: Z("17:00"), reason: "maintenance", reason_label: "Maintenance", overlaps_confirmed_booking: false },
  { kind: "closed", status: "UNAVAILABLE", label: "Unavailable", start: Z("18:00"), end: Z("24:00") },
];
const orchid = venueFixture({ operating_hours: { start: "08:00", end: "18:00" }, periods: booking }) as unknown as CalendarVenue;
const block = (kind: string) => document.querySelector(`[data-block][data-kind="${kind}"]`) as HTMLElement;
const left = (el: HTMLElement) => parseFloat(el.style.left);
const width = (el: HTMLElement) => parseFloat(el.style.width);

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-130/AC1 a booking's setup and turnaround show as occupied, apart from the event", () => {
  it("SCRUM-130/AC1 occupies 09:30 to 12:45 for a 10:00 to 12:00 booking with 30 min setup and 45 min turnaround", () => {
    render(<VenueDayView venues={[orchid]} date="2026-11-14" />);
    const [setup, event, turnaround] = [block("setup"), block("event"), block("turnaround")];
    // 08:00 to 20:00 is 12 hours: 09:30 is 12.5% in; the whole stretch is 3.25 hours
    expect(left(setup)).toBeCloseTo(12.5);
    expect(left(event)).toBeCloseTo(left(setup) + width(setup));
    expect(left(turnaround)).toBeCloseTo(left(event) + width(event));
    expect(left(turnaround) + width(turnaround) - left(setup)).toBeCloseTo((3.25 / 12) * 100);
    expect(within(event).getByText(/10:00–12:00 · occupied 09:30–12:45/)).toBeTruthy();
  });

  it("SCRUM-130/AC1 draws setup and turnaround dashed and names them, and the event solid", () => {
    render(<VenueDayView venues={[orchid]} date="2026-11-14" />);
    expect(block("setup").className).toContain("border-dashed");
    expect(block("turnaround").className).toContain("border-dashed");
    expect(block("event").className).not.toContain("border-dashed");
    expect(screen.getByRole("button", { name: /^Details: Confirmed Setup, 2026-11-14 09:30 to 10:00$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Details: Confirmed Turnaround, 2026-11-14 12:00 to 12:45$/ })).toBeTruthy();
  });

  it("SCRUM-130/AC1 says nothing extra on a booking with no setup or turnaround", () => {
    render(<VenueDayView venues={[orchid]} date="2026-11-14" />);
    const held = document.querySelectorAll('[data-block][data-kind="event"]')[1] as HTMLElement;
    expect(held.textContent).toContain("14:00–15:00");
    expect(held.textContent).not.toContain("occupied");
  });

  it("SCRUM-130/AC1 explains the dashed blocks under the calendar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture())));
    render(<VenueCalendar now={NOW} />);
    expect(await screen.findByText(/Dashed blocks either side of each booking are the venue's setup and turnaround time\. They count as occupied/)).toBeTruthy();
  });
});

describe("SCRUM-84/AC2 to AC4 every period is named in words", () => {
  it("SCRUM-84/AC2 labels a held, a confirmed and a blocked period in text with its times", () => {
    render(<VenueDayView venues={[orchid]} date="2026-11-14" />);
    const events = document.querySelectorAll('[data-block][data-kind="event"]');
    expect(events[0].textContent).toContain("Confirmed");
    expect(events[1].textContent).toContain("Tentatively Held");
    expect(block("block").textContent).toContain("Blocked: Maintenance");
    expect(block("block").textContent).toContain("15:30–17:00");
  });

  it("SCRUM-84/AC3 names free time Available for screen readers and keeps it plain", () => {
    render(<VenueDayView venues={[orchid]} date="2026-11-14" />);
    const free = block("open");
    expect(within(free).getByText("Available").className).toContain("sr-only");
    expect(free.className).not.toMatch(/bg-status/);
  });

  it("SCRUM-84/AC4 shows time outside operating hours as Unavailable, and never calls a block that", () => {
    render(<VenueDayView venues={[orchid]} date="2026-11-14" />);
    expect(block("closed").textContent).toContain("Unavailable");
    expect(block("closed").textContent).toContain("18:00–20:00");
    expect(block("block").textContent).not.toContain("Unavailable");
  });
});

describe("SCRUM-130/AC2 a block is a distinct pattern with its reason", () => {
  it("SCRUM-130/AC2 stripes only the block, grey, and in red with a warning where it lies over a confirmed booking", () => {
    const conflict = venueFixture({ id: "c", name: "Clash Hall", periods: [{ ...booking[6], overlaps_confirmed_booking: true }] }) as unknown as CalendarVenue;
    render(<VenueDayView venues={[orchid, conflict]} date="2026-11-14" />);
    const [grey, red] = document.querySelectorAll('[data-block][data-kind="block"]') as NodeListOf<HTMLElement>;
    expect(grey.className).toContain("calendar-block");
    expect(grey.className).toContain("bg-status-neutral");
    expect(red.className).toContain("calendar-block");
    expect(red.className).toContain("bg-status-danger");
    expect(red.textContent).toContain("conflicts with a confirmed booking");
    expect(document.querySelectorAll(".calendar-block")).toHaveLength(2);
  });

  it("SCRUM-130/AC2 has the striped rule in the stylesheet, drawn in the block's own colour", () => {
    const css = readFileSync(resolve(__dirname, "../../src/app/globals.css"), "utf8");
    expect(css).toMatch(/\.calendar-block\s*\{[^}]*repeating-linear-gradient\([^}]*currentColor/);
  });

  it("SCRUM-130/AC2 gives the reason on tap or focus from the block itself", () => {
    render(<VenueDayView venues={[orchid]} date="2026-11-14" />);
    const hint = within(block("block")).getByRole("button", { name: /why is this blocked/i });
    fireEvent.focus(hint);
    expect(screen.getByRole("tooltip").textContent).toBe("Blocked: Maintenance");
  });

  it("SCRUM-130/AC2 calls out a closure over confirmed bookings in a banner, with a link to the bookings for Venue Staff", async () => {
    const pieces = [
      { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("00:00", 12), end: Z("10:00", 14), reason_label: "Maintenance", overlaps_confirmed_booking: false },
      { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("10:00", 14), end: Z("24:00", 16), reason_label: "Maintenance", overlaps_confirmed_booking: true },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ venues: [venueFixture({ name: "Hall B", periods: pieces })] }))));
    const { unmount } = render(<VenueCalendar canMarkUnavailable now={NOW} />);
    expect(await screen.findByText("Hall B is unavailable 12 Nov 00:00 to 17 Nov 00:00 (Maintenance)")).toBeTruthy();
    expect(screen.getByText(/Confirmed bookings in this period are affected/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "View affected bookings" }).getAttribute("href")).toBe("/booking-queue");
    unmount();
    render(<VenueCalendar now={NOW} />);
    await screen.findByText(/Hall B is unavailable/);
    expect(screen.queryByRole("link", { name: "View affected bookings" })).toBeNull();
  });

  it("SCRUM-130/AC2 shows no banner for a closure over nothing confirmed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ venues: [orchid] }))));
    render(<VenueCalendar now={NOW} />);
    await screen.findByText("Orchid Hall");
    expect(screen.queryByText(/is unavailable/)).toBeNull();
  });
});

describe("SCRUM-130 the now line", () => {
  it("SCRUM-130 marks the current time on today's day view only", () => {
    const { unmount } = render(<VenueDayView venues={[orchid]} date="2026-11-14" now={NOW} />);
    expect(document.querySelector("[data-now]")).not.toBeNull();
    expect(document.querySelector("[data-now-label]")?.textContent).toBe("10:15");
    unmount();
    render(<VenueDayView venues={[orchid]} date="2026-11-15" now={NOW} />);
    expect(document.querySelector("[data-now]")).toBeNull();
  });
});

describe("SCRUM-130 review gaps", () => {
  it("SCRUM-130/AC2 leaves the reason out of the banner when none was recorded", async () => {
    const flagged = { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("09:00"), end: Z("11:00"), overlaps_confirmed_booking: true };
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ venues: [venueFixture({ name: "Hall C", periods: [flagged] })] }))));
    render(<VenueCalendar now={NOW} />);
    expect(await screen.findByText("Hall C is unavailable 14 Nov 09:00 to 14 Nov 11:00")).toBeTruthy();
  });

  it("SCRUM-130 draws the now line from the real clock when none is given", () => {
    render(<VenueDayView venues={[orchid]} date={todaySgt()} />);
    // between 08:00 and 20:00 Singapore time the line is shown; outside those hours it is not
    const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Singapore" }).format(new Date()));
    expect(document.querySelector("[data-now]") !== null).toBe(hour >= 8 && hour < 20);
  });



});
