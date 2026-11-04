// SCRUM-85: choose a period on the venue calendar and see exactly what it is and when it starts and ends. Since SCRUM-130 the
// details open in a popover beside the period (Figma 09a), the same on the day, week and month views.
// 14 Nov 2026 in Singapore (UTC+8): 10:00 is 02:00Z.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VenueDayView } from "@/components/venue-calendar/VenueDayTimeline";
import { VenueMonthGrid } from "@/components/venue-calendar/VenueMonthGrid";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { venueFixture } from "./venue-calendar-fixtures";

const Z = (hhmmSgt: string, day = 14) => {
  const [h, m] = hhmmSgt.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, day, h - 8, m)).toISOString();
};

// 08:00-09:30 free, 09:30-10:00 setup, 10:00-12:00 confirmed event, 12:00-12:45 turnaround, 12:45-14:00 blocked, 14:00-18:00 free, 18:00-22:00 closed
const venue = venueFixture({
  periods: [
    { kind: "open", status: "AVAILABLE", label: "Available", start: Z("08:00"), end: Z("09:30") },
    { kind: "setup", status: "CONFIRMED", label: "Confirmed", start: Z("09:30"), end: Z("10:00") },
    { kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("10:00"), end: Z("12:00"), occupied_start: Z("09:30"), occupied_end: Z("12:45"), setup_minutes: 30, turnaround_minutes: 45 },
    { kind: "turnaround", status: "CONFIRMED", label: "Confirmed", start: Z("12:00"), end: Z("12:45") },
    { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("12:45"), end: Z("14:00"), reason: "maintenance", reason_label: "Maintenance", overlaps_confirmed_booking: false },
    { kind: "open", status: "AVAILABLE", label: "Available", start: Z("14:00"), end: Z("18:00") },
    { kind: "closed", status: "UNAVAILABLE", label: "Unavailable", start: Z("18:00"), end: Z("22:00") },
  ],
}) as unknown as CalendarVenue;
const mk = (periods: unknown[], over: Record<string, unknown> = {}) => venueFixture({ periods, ...over }) as unknown as CalendarVenue;

/** Opens the details of the period whose button name matches, on the day view of `venues`. */
async function open(name: RegExp, venues: CalendarVenue[] = [venue]) {
  render(<VenueDayView venues={venues} date="2026-11-14" />);
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.findByLabelText("Availability details");
}
const row = (details: HTMLElement, term: string) => within(details).getByText(term).nextElementSibling?.textContent;
const closed = () => waitFor(() => expect(screen.queryByLabelText("Availability details")).toBeNull());

describe("SCRUM-85/AC1 open the details of a period", () => {
  it("SCRUM-85/AC1 shows the venue's name, location and maximum capacity, and the status", async () => {
    const details = await open(/^Details: Blocked, 2026-11-14 12:45 to 14:00$/);
    expect(within(details).getByText("Orchid Hall")).toBeTruthy();
    expect(within(details).getByText("1 Marina Boulevard · Max capacity 150")).toBeTruthy();
    expect(within(details).getByText("Blocked")).toBeTruthy();
    expect(within(details).getByTestId("status-icon")).toBeTruthy();
  });

  it("SCRUM-85/AC1 shows exactly when a period starts and ends, in Singapore time", async () => {
    const details = await open(/^Details: Unavailable/);
    expect(row(details, "Starts")).toBe("2026-11-14 18:00");
    expect(row(details, "Ends")).toBe("2026-11-14 22:00");
    expect(row(details, "Why")).toBe("Outside operating hours");
  });

  it("SCRUM-85/AC1 shows a booking's day and times", async () => {
    const details = await open(/^Details: Confirmed Event/);
    expect(row(details, "Held")).toBe("Sat 14 Nov, 10:00–12:00");
  });

  it("SCRUM-85/AC1 shows a tentatively held booking too", async () => {
    const details = await open(/^Details: Tentatively Held/, [mk([{ kind: "event", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: Z("10:00"), end: Z("12:00") }])]);
    expect(within(details).getByText("Tentatively Held")).toBeTruthy();
    expect(row(details, "Held")).toBe("Sat 14 Nov, 10:00–12:00");
  });

  it("SCRUM-85/AC1 shows nothing until a period is chosen, marks the open one, and Close or choosing it again shuts it", async () => {
    render(<VenueDayView venues={[venue]} date="2026-11-14" />);
    expect(screen.queryByLabelText("Availability details")).toBeNull();
    const button = screen.getByRole("button", { name: /^Details: Blocked/ });
    fireEvent.click(button);
    const details = await screen.findByLabelText("Availability details");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(details).getByRole("button", { name: "Close details" }));
    await closed();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    await screen.findByLabelText("Availability details");
    fireEvent.click(button);
    await closed();
  });

  it("SCRUM-85/AC1 shows the right venue's facts when two venues are shown", async () => {
    const a = mk([{ kind: "open", status: "AVAILABLE", label: "Available", start: Z("08:00"), end: Z("18:00") }], { id: "a", name: "Orchid Hall" });
    const b = mk([{ kind: "block", status: "BLOCKED", label: "Blocked", start: Z("08:00"), end: Z("18:00"), reason_label: "Renovation" }], { id: "b", name: "Jasmine Room", address: "2 Marina Boulevard", max_capacity: 40 });
    const details = await open(/^Details: Blocked/, [a, b]);
    expect(screen.getAllByLabelText("Availability details")).toHaveLength(1);
    expect(within(details).getByText("Jasmine Room")).toBeTruthy();
    expect(within(details).getByText("2 Marina Boulevard · Max capacity 40")).toBeTruthy();
    expect(row(details, "Reason")).toBe("Renovation");
  });

  it("SCRUM-85/AC1 converts times across midnight into Singapore dates", async () => {
    // a setup stretch, which widens the day view to midnight, so the late period is on screen
    const late = mk([{ kind: "setup", status: "CONFIRMED", label: "Confirmed", start: "2026-11-14T15:30:00.000Z", end: "2026-11-14T17:15:00.000Z" }]);
    const details = await open(/^Details/, [late]);
    expect(row(details, "Starts")).toBe("2026-11-14 23:30");
    expect(row(details, "Ends")).toBe("2026-11-15 01:15");
  });
});

describe("SCRUM-85/AC2 the free window", () => {
  it("SCRUM-85/AC2 shows when the continuous available window starts and ends", async () => {
    const details = await open(/^Details: Available, 2026-11-14 14:00 to 18:00$/);
    expect(row(details, "Free window")).toBe("Free from 2026-11-14 14:00 until 2026-11-14 18:00");
  });

  it("SCRUM-85/AC2 shows a free window cut by the dates shown only up to the edge of those dates (pinned behaviour)", async () => {
    const details = await open(/^Details/, [mk([{ kind: "open", status: "AVAILABLE", label: "Available", start: Z("14:00"), end: Z("24:00") }])]);
    expect(row(details, "Free window")).toBe("Free from 2026-11-14 14:00 until 2026-11-15 00:00");
  });

  it("SCRUM-85/AC2 gives a booking its next free window", async () => {
    const details = await open(/^Details: Confirmed Event/);
    expect(row(details, "Next free window")).toBe("14:00–18:00");
  });
});

describe("SCRUM-85/AC3 the reason for a block", () => {
  it.each([
    ["maintenance", "Maintenance"], ["renovation", "Renovation"], ["safety_restriction", "Safety restriction"],
    ["internal_activity", "Internal activity"], ["other", "Other"],
  ])("SCRUM-85/AC3 shows %s as %s", async (reason, label) => {
    const details = await open(/^Details/, [mk([{ kind: "block", status: "BLOCKED", label: "Blocked", start: Z("12:00"), end: Z("14:00"), reason, reason_label: label, overlaps_confirmed_booking: false }])]);
    expect(row(details, "Reason")).toBe(label);
  });

  it("SCRUM-85/AC3 does not invent a reason for a period that is not a block", async () => {
    const details = await open(/^Details: Unavailable/);
    expect(within(details).queryByText("Reason")).toBeNull();
  });

  it("SCRUM-85/AC3 shows the reason and the conflict together for a block over a confirmed booking", async () => {
    const details = await open(/^Details/, [mk([{ kind: "block", status: "BLOCKED", label: "Blocked", start: Z("09:30"), end: Z("12:45"), reason_label: "Safety restriction", overlaps_confirmed_booking: true }])]);
    expect(row(details, "Reason")).toBe("Safety restriction");
    expect(row(details, "Note")).toBe("Conflicts with a confirmed booking");
    expect(within(details).getByText("Blocked · conflict")).toBeTruthy();
  });

  it("SCRUM-85/AC3 shows the status and times of a block with no reason, and no empty Reason line", async () => {
    const details = await open(/^Details/, [mk([{ kind: "block", status: "BLOCKED", label: "Blocked", start: Z("09:00"), end: Z("11:00") }])]);
    expect(within(details).queryByText("Reason")).toBeNull();
    expect(row(details, "Starts")).toBe("2026-11-14 09:00");
  });
});

describe("SCRUM-85/AC4 setup and turnaround time", () => {
  it("SCRUM-85/AC4 gives a booking its setup and turnaround, so the whole time it occupies the venue is shown", async () => {
    const details = await open(/^Details: Confirmed Event/);
    expect(row(details, "Setup")).toBe("09:30–10:00");
    expect(row(details, "Turnaround")).toBe("12:00–12:45");
  });

  it("SCRUM-85/AC4 leaves out setup and turnaround a booking does not have", async () => {
    const details = await open(/^Details/, [mk([{ kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("10:00"), end: Z("12:00") }])]);
    expect(within(details).queryByText("Setup")).toBeNull();
    expect(within(details).queryByText("Turnaround")).toBeNull();
    expect(within(details).queryByText("Next free window")).toBeNull();
  });

  it("SCRUM-85/AC4 labels setup as setup time for the booking that follows it, and never Available", async () => {
    const details = await open(/^Details: Confirmed Setup/);
    expect(row(details, "What it is")).toBe("Setup time for the booking that starts 2026-11-14 10:00");
    expect(within(details).queryByText("Available")).toBeNull();
  });

  it("SCRUM-85/AC4 labels turnaround as turnaround time for the booking before it, and never Available", async () => {
    const details = await open(/^Details: Confirmed Turnaround/);
    expect(row(details, "What it is")).toBe("Turnaround time for the booking that ends 2026-11-14 12:00");
    expect(within(details).queryByText("Available")).toBeNull();
  });

  it("SCRUM-85/AC4 ties setup and turnaround to the right booking when there are two", async () => {
    const two = mk([
      { kind: "setup", status: "CONFIRMED", label: "Confirmed", start: Z("09:30"), end: Z("10:00") },
      { kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("10:00"), end: Z("12:00") },
      { kind: "turnaround", status: "CONFIRMED", label: "Confirmed", start: Z("12:00"), end: Z("12:45") },
      { kind: "setup", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: Z("14:30"), end: Z("15:00") },
      { kind: "event", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: Z("15:00"), end: Z("17:00") },
    ]);
    const details = await open(/^Details: Tentatively Held Setup/, [two]);
    expect(row(details, "What it is")).toBe("Setup time for the booking that starts 2026-11-14 15:00");
  });

  it.each([
    ["setup", "23:00", "24:00", "Setup time for a booking that starts after this period"],
    ["turnaround", "00:00", "00:45", "Turnaround time for a booking that ends before this period"],
  ])("SCRUM-85/AC4 says what a lone %s belongs to when its booking is outside the dates", async (kind, from, to, text) => {
    const details = await open(/^Details/, [mk([{ kind, status: "CONFIRMED", label: "Confirmed", start: Z(from), end: Z(to) }])]);
    expect(row(details, "What it is")).toBe(text);
  });
});

describe("SCRUM-85 on the month view", () => {
  const busy = mk([
    { kind: "open", status: "AVAILABLE", label: "Available", start: Z("08:00", 2), end: Z("22:00", 2) },
    { kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("10:00"), end: Z("12:00") },
    { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("15:00"), end: Z("17:00"), reason_label: "Maintenance" },
    { kind: "closed", status: "UNAVAILABLE", label: "Unavailable", start: Z("00:00", 3), end: Z("24:00", 3) },
  ]);
  const month = (onOpenDay = vi.fn()) => render(<VenueMonthGrid venues={[busy]} from="2026-11-01" to="2026-11-30" today="2026-11-14" onOpenDay={onOpenDay} />);

  it("SCRUM-85/AC1 opens a day's details: its busiest status, and each booking and block with its times, then Open day view", async () => {
    const onOpenDay = vi.fn();
    month(onOpenDay);
    fireEvent.click(screen.getByRole("button", { name: "Details: Orchid Hall on Sat 14 Nov: Blocked" }));
    const details = await screen.findByLabelText("Availability details");
    expect(within(details).getByText("Blocked")).toBeTruthy();
    expect(row(details, "Day")).toBe("Sat 14 Nov");
    expect(row(details, "Confirmed")).toBe("10:00–12:00");
    expect(row(details, "Blocked: Maintenance")).toBe("15:00–17:00");
    fireEvent.click(within(details).getByRole("button", { name: "Open day view" }));
    expect(onOpenDay).toHaveBeenCalledWith("2026-11-14");
    await closed();
  });

  it("SCRUM-85/AC2 says a free day is available with its hours, and a closed day is closed", async () => {
    month();
    fireEvent.click(screen.getByRole("button", { name: "Details: Orchid Hall on Mon 2 Nov: Free" }));
    let details = await screen.findByLabelText("Availability details");
    expect(row(details, "Available")).toBe("08:00–22:00");
    fireEvent.click(within(details).getByRole("button", { name: "Close details" }));
    await closed();
    fireEvent.click(screen.getByRole("button", { name: "Details: Orchid Hall on Tue 3 Nov: Closed" }));
    details = await screen.findByLabelText("Availability details");
    expect(within(details).getByText("Closed")).toBeTruthy();
    expect(row(details, "Why")).toBe("Outside operating hours");
  });
});
