// SCRUM-130: the venue calendar shows real occupancy (AC1), blocks as a distinct pattern with the reason (AC2), and lets Venue Staff
// mark a venue unavailable from the calendar, showing it straight away (AC3). 14 Nov 2026 in Singapore: 10:00 is 02:00Z.

import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";


import { VenueCalendarVenue } from "@/components/venue-calendar/VenueCalendarVenue";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { venueFixture } from "./venue-calendar-fixtures";

const Z = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 14, h - 8, m)).toISOString();
};
const booked = venueFixture({
  periods: [
    { kind: "setup", status: "CONFIRMED", label: "Confirmed", start: Z("09:30"), end: Z("10:00") },
    { kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("10:00"), end: Z("12:00"), event_start: Z("10:00"), event_end: Z("12:00"), occupied_start: Z("09:30"), occupied_end: Z("12:45"), setup_minutes: 30, turnaround_minutes: 45 },
    { kind: "turnaround", status: "CONFIRMED", label: "Confirmed", start: Z("12:00"), end: Z("12:45") },
    { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("13:00"), end: Z("15:00"), reason: "maintenance", reason_label: "Maintenance", overlaps_confirmed_booking: false },
    { kind: "open", status: "AVAILABLE", label: "Available", start: Z("15:00"), end: Z("18:00") },
    { kind: "closed", status: "UNAVAILABLE", label: "Unavailable", start: Z("18:00"), end: Z("22:00") },
  ],
}) as unknown as CalendarVenue;

const row = (kind: string) => document.querySelector(`li[data-kind="${kind}"]`) as HTMLElement;

describe("SCRUM-130/AC1 real occupancy", () => {
  it("says the venue is occupied from 09:30 to 12:45 on the booking, with the setup and turnaround minutes", () => {
    render(<VenueCalendarVenue venue={booked} />);
    expect(within(row("event")).getByText("Occupied 2026-11-14 09:30 to 12:45 (setup 30 min, turnaround 45 min)")).toBeTruthy();
  });

  it("names setup and turnaround in words and draws them differently from the event", () => {
    render(<VenueCalendarVenue venue={booked} />);
    expect(within(row("setup")).getByText("Setup")).toBeTruthy();
    expect(within(row("turnaround")).getByText("Turnaround")).toBeTruthy();
    expect(within(row("event")).getByText("Event")).toBeTruthy();
    for (const kind of ["setup", "turnaround"]) {
      expect(row(kind).className).toMatch(/border-dashed/);
      expect(row(kind).className).toMatch(/bg-muted/);
    }
    expect(row("event").className).not.toMatch(/border-dashed/);
    expect(row("event").className).not.toMatch(/bg-muted/);
  });

  it("shows no occupied line on anything but a booking", () => {
    render(<VenueCalendarVenue venue={booked} />);
    for (const kind of ["setup", "turnaround", "block", "open", "closed"]) expect(within(row(kind)).queryByText(/Occupied/)).toBeNull();
  });
});

describe("SCRUM-130/AC2 a block is a distinct pattern with its reason", () => {
  it("marks only the block with the striped pattern and gives it the reason as a hover title as well as visible text", () => {
    render(<VenueCalendarVenue venue={booked} />);
    expect(row("block").className).toMatch(/calendar-block/);
    expect(row("block").getAttribute("title")).toBe("Blocked: Maintenance");
    expect(within(row("block")).getByText("Maintenance")).toBeTruthy();
    for (const kind of ["setup", "event", "turnaround", "open", "closed"]) {
      expect(row(kind).className).not.toMatch(/calendar-block/);
      expect(row(kind).getAttribute("title")).toBeNull();
    }
  });

  it("falls back to just the status in the title when no reason was recorded", () => {
    const v = venueFixture({ periods: [{ kind: "block", status: "BLOCKED", label: "Blocked", start: Z("09:00"), end: Z("10:00") }] }) as unknown as CalendarVenue;
    render(<VenueCalendarVenue venue={v} />);
    expect(row("block").getAttribute("title")).toBe("Blocked");
  });
});

