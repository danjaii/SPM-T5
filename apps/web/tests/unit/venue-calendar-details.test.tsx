// SCRUM-85: select a period on the venue calendar and see exactly what it is and when it starts and ends.
// 14 Nov 2026 in Singapore (UTC+8): 10:00 is 02:00Z.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VenueCalendarVenue } from "@/components/venue-calendar/VenueCalendarVenue";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { venueFixture } from "./venue-calendar-fixtures";

const Z = (hhmmSgt: string) => {
  const [h, m] = hhmmSgt.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 14, h - 8, m)).toISOString();
};

// 08:00-09:30 free, 09:30-10:00 setup, 10:00-12:00 confirmed event, 12:00-12:45 turnaround, 12:45-14:00 blocked, 14:00-18:00 free, 18:00-22:00 closed
const venue = venueFixture({
  periods: [
    { kind: "open", status: "AVAILABLE", label: "Available", start: Z("08:00"), end: Z("09:30") },
    { kind: "setup", status: "CONFIRMED", label: "Confirmed", start: Z("09:30"), end: Z("10:00") },
    { kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("10:00"), end: Z("12:00"), event_start: Z("10:00"), event_end: Z("12:00"), occupied_start: Z("09:30"), occupied_end: Z("12:45"), setup_minutes: 30, turnaround_minutes: 45 },
    { kind: "turnaround", status: "CONFIRMED", label: "Confirmed", start: Z("12:00"), end: Z("12:45") },
    { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("12:45"), end: Z("14:00"), reason: "maintenance", reason_label: "Maintenance", overlaps_confirmed_booking: false },
    { kind: "open", status: "AVAILABLE", label: "Available", start: Z("14:00"), end: Z("18:00") },
    { kind: "closed", status: "UNAVAILABLE", label: "Unavailable", start: Z("18:00"), end: Z("22:00") },
  ],
}) as unknown as CalendarVenue;

const open = (nameStart: RegExp) => {
  render(<VenueCalendarVenue venue={venue} />);
  fireEvent.click(screen.getByRole("button", { name: nameStart }));
  return screen.getByRole("region", { name: "Availability details" });
};

describe("SCRUM-85/AC1 open the details of a period", () => {
  it("shows the venue's name, location and maximum capacity, the status and when it starts and ends", () => {
    const details = open(/Details.*Confirmed.*10:00 to 12:00/);
    expect(within(details).getByText("Orchid Hall")).toBeTruthy();
    expect(within(details).getByText(/1 Marina Boulevard/)).toBeTruthy();
    expect(within(details).getByText(/Capacity 150/)).toBeTruthy();
    expect(within(details).getByText("Confirmed")).toBeTruthy();
    expect(within(details).getByText("2026-11-14 10:00")).toBeTruthy(); // starts
    expect(within(details).getByText("2026-11-14 12:00")).toBeTruthy(); // ends
  });

  it("shows no details until a period is chosen, and a different period replaces the last", () => {
    render(<VenueCalendarVenue venue={venue} />);
    expect(screen.queryByRole("region", { name: "Availability details" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Details.*Blocked/ }));
    expect(within(screen.getByRole("region", { name: "Availability details" })).getByText("Blocked")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Details.*Unavailable/ }));
    const details = screen.getByRole("region", { name: "Availability details" });
    expect(within(details).queryByText("Blocked")).toBeNull();
    expect(within(details).getByText("Unavailable")).toBeTruthy();
  });

  it("can be closed again", () => {
    const details = open(/Details.*Blocked/);
    fireEvent.click(within(details).getByRole("button", { name: "Close details" }));
    expect(screen.queryByRole("region", { name: "Availability details" })).toBeNull();
  });

  it("marks which period is open", () => {
    render(<VenueCalendarVenue venue={venue} />);
    const button = screen.getByRole("button", { name: /Details.*Blocked/ });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("SCRUM-85/AC2 the free window", () => {
  it("shows when the continuous available window starts and ends", () => {
    const details = open(/Details.*Available.*14:00 to 18:00/);
    expect(within(details).getByText(/Free from 2026-11-14 14:00 until 2026-11-14 18:00/)).toBeTruthy();
  });
});

describe("SCRUM-85/AC3 the reason for a block", () => {
  it("shows the reason Venue Staff recorded", () => {
    const details = open(/Details.*Blocked/);
    expect(within(details).getByText("Reason")).toBeTruthy();
    expect(within(details).getByText("Maintenance")).toBeTruthy();
  });

  it("does not invent a reason for a period that is not a block", () => {
    const details = open(/Details.*Available.*08:00 to 09:30/);
    expect(within(details).queryByText("Reason")).toBeNull();
  });
});

describe("SCRUM-85/AC4 setup and turnaround time", () => {
  it("labels setup as setup time for the booking that follows it", () => {
    const details = open(/Details.*Confirmed.*09:30 to 10:00/);
    expect(within(details).getByText(/Setup time for the booking that starts 2026-11-14 10:00/)).toBeTruthy();
  });

  it("labels turnaround as turnaround time for the booking before it", () => {
    const details = open(/Details.*Confirmed.*12:00 to 12:45/);
    expect(within(details).getByText(/Turnaround time for the booking that ends 2026-11-14 12:00/)).toBeTruthy();
  });

  it("shows a booking's event time and the whole time it occupies the venue", () => {
    const details = open(/Details.*Confirmed.*10:00 to 12:00/);
    expect(within(details).getByText(/Occupied 2026-11-14 09:30 to 2026-11-14 12:45 including setup and turnaround/)).toBeTruthy();
  });

  it("says plainly when the setup or turnaround belongs to a booking outside the dates shown", () => {
    const lone = venueFixture({ periods: [{ kind: "setup", status: "CONFIRMED", label: "Confirmed", start: Z("09:30"), end: Z("10:00") }] }) as unknown as CalendarVenue;
    render(<VenueCalendarVenue venue={lone} />);
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(within(screen.getByRole("region", { name: "Availability details" })).getByText(/Setup time for a booking/)).toBeTruthy();
  });
});

describe("SCRUM-85/AC1 a period outside operating hours", () => {
  it("says it is outside the venue's operating hours", () => {
    const details = open(/Details.*Unavailable/);
    expect(within(details).getByText(/Outside operating hours/)).toBeTruthy();
  });
});
