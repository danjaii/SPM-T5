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

// Added after the independent review
const mk = (periods: unknown[], over: Record<string, unknown> = {}) => venueFixture({ periods, ...over }) as unknown as CalendarVenue;
const pick = (v: CalendarVenue, name: RegExp) => {
  render(<VenueCalendarVenue venue={v} />);
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.getByRole("region", { name: "Availability details" });
};

describe("SCRUM-85 review gaps", () => {
  it("SCRUM-85/AC2 shows a free window that is cut by the chosen dates only up to the edge of those dates (pinned behaviour)", () => {
    const v = mk([{ kind: "open", status: "AVAILABLE", label: "Available", start: Z("14:00"), end: Z("24:00") }]);
    expect(within(pick(v, /Details/)).getByText("Free from 2026-11-14 14:00 until 2026-11-15 00:00")).toBeTruthy();
  });

  it("SCRUM-85/AC3 shows the reason and the conflict note together for a block over a confirmed booking", () => {
    const v = mk([{ kind: "block", status: "BLOCKED", label: "Blocked", start: Z("09:30"), end: Z("12:45"), reason: "safety", reason_label: "Safety restriction", overlaps_confirmed_booking: true }]);
    const details = pick(v, /Details/);
    expect(within(details).getByText("Safety restriction")).toBeTruthy();
    expect(within(details).getByText("Conflicts with a confirmed booking")).toBeTruthy();
  });

  it("SCRUM-85/AC3 shows the status and times of a block with no reason, and no empty Reason line", () => {
    const v = mk([{ kind: "block", status: "BLOCKED", label: "Blocked", start: Z("09:00"), end: Z("11:00") }]);
    const details = pick(v, /Details/);
    expect(within(details).queryByText("Reason")).toBeNull();
    expect(within(details).getByText("Blocked")).toBeTruthy();
    expect(within(details).getByText("2026-11-14 09:00")).toBeTruthy();
  });

  it.each(["Setup", "Turnaround"])("SCRUM-85/AC4 never calls the %s stretch of a booking Available", (what) => {
    const range = what === "Setup" ? /Details.*Confirmed.*09:30 to 10:00/ : /Details.*Confirmed.*12:00 to 12:45/;
    const details = open(range);
    expect(within(details).queryByText("Available")).toBeNull();
    expect(within(details).getByText("Confirmed")).toBeTruthy();
    for (const row of document.querySelectorAll('li[data-kind="setup"], li[data-kind="turnaround"]')) expect(row.textContent).not.toMatch(/Available/);
  });

  it("SCRUM-85/AC4 ties setup and turnaround to the right booking when there are two", () => {
    const v = mk([
      { kind: "setup", status: "CONFIRMED", label: "Confirmed", start: Z("09:30"), end: Z("10:00") },
      { kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("10:00"), end: Z("12:00") },
      { kind: "turnaround", status: "CONFIRMED", label: "Confirmed", start: Z("12:00"), end: Z("12:45") },
      { kind: "setup", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: Z("14:30"), end: Z("15:00") },
      { kind: "event", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: Z("15:00"), end: Z("17:00") },
      { kind: "turnaround", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: Z("17:00"), end: Z("17:45") },
    ]);
    render(<VenueCalendarVenue venue={v} />);
    fireEvent.click(screen.getByRole("button", { name: /Details.*Tentatively Held.*14:30 to 15:00/ }));
    expect(within(screen.getByRole("region", { name: "Availability details" })).getByText("Setup time for the booking that starts 2026-11-14 15:00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Details.*Confirmed.*12:00 to 12:45/ }));
    expect(within(screen.getByRole("region", { name: "Availability details" })).getByText("Turnaround time for the booking that ends 2026-11-14 12:00")).toBeTruthy();
  });

  it("SCRUM-85/AC4 says exactly what a lone setup or turnaround belongs to when its booking is outside the dates", () => {
    const setup = mk([{ kind: "setup", status: "CONFIRMED", label: "Confirmed", start: Z("23:00"), end: Z("24:00") }]);
    expect(within(pick(setup, /Details/)).getByText("Setup time for a booking that starts after this period")).toBeTruthy();
    document.body.innerHTML = "";
    const turn = mk([{ kind: "turnaround", status: "CONFIRMED", label: "Confirmed", start: Z("00:00"), end: Z("00:45") }]);
    expect(within(pick(turn, /Details/)).getByText("Turnaround time for a booking that ends before this period")).toBeTruthy();
  });

  it("SCRUM-85/AC1 keeps each venue's selection to itself and shows the right venue's facts", () => {
    const a = mk([{ kind: "open", status: "AVAILABLE", label: "Available", start: Z("08:00"), end: Z("18:00") }], { id: "a", name: "Orchid Hall" });
    const b = mk([{ kind: "block", status: "BLOCKED", label: "Blocked", start: Z("08:00"), end: Z("18:00"), reason_label: "Renovation" }], { id: "b", name: "Jasmine Room", address: "2 Marina Boulevard", max_capacity: 40 });
    render(<><VenueCalendarVenue venue={a} /><VenueCalendarVenue venue={b} /></>);
    fireEvent.click(screen.getByRole("button", { name: /Details: Blocked/ }));
    const regions = screen.getAllByRole("region", { name: "Availability details" });
    expect(regions).toHaveLength(1);
    expect(within(regions[0]).getByText("Jasmine Room")).toBeTruthy();
    expect(within(regions[0]).getByText(/2 Marina Boulevard · Capacity 40/)).toBeTruthy();
    expect(within(regions[0]).getByText("Renovation")).toBeTruthy();
  });

  it("SCRUM-85/AC1 shows the status, start and end of a period outside operating hours", () => {
    const details = open(/Details.*Unavailable/);
    expect(within(details).getByText("Unavailable")).toBeTruthy();
    expect(within(details).getByText("2026-11-14 18:00")).toBeTruthy();
    expect(within(details).getByText("2026-11-14 22:00")).toBeTruthy();
  });

  it("SCRUM-85/AC1 switching clears the first period's pressed state and shows the second one's times", () => {
    render(<VenueCalendarVenue venue={venue} />);
    const first = screen.getByRole("button", { name: /Details.*Blocked/ });
    fireEvent.click(first);
    fireEvent.click(screen.getByRole("button", { name: /Details.*Unavailable/ }));
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(within(screen.getByRole("region", { name: "Availability details" })).getByText("2026-11-14 18:00")).toBeTruthy();
  });

  it("SCRUM-85/AC1 converts times across midnight into Singapore dates", () => {
    const v = mk([{ kind: "open", status: "AVAILABLE", label: "Available", start: "2026-11-14T15:30:00.000Z", end: "2026-11-14T17:15:00.000Z" }]);
    const details = pick(v, /Details/);
    expect(within(details).getByText("2026-11-14 23:30")).toBeTruthy();
    expect(within(details).getByText("2026-11-15 01:15")).toBeTruthy();
  });
});
