// SCRUM-130 week view (Figma 09a) and month view: every venue a row and the days across. A week day has an occupancy bar for 08:00
// to 22:00, its bookings and single-day blocks as chips, or says it is available or closed; a block over several days is one
// banner; choosing a period opens its details. 14 Nov 2026 is a Saturday; in Singapore (UTC+8) 10:00 is 02:00Z.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { VenueMonthGrid } from "@/components/venue-calendar/VenueMonthGrid";
import { VenueWeekGrid } from "@/components/venue-calendar/VenueWeekGrid";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { calendarFixture, jsonReply, venueFixture } from "./venue-calendar-fixtures";

const Z = (hhmm: string, day = 14) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, day, h - 8, m)).toISOString();
};
const open = (day: number, from = "08:00", to = "22:00") => ({ kind: "open", status: "AVAILABLE", label: "Available", start: Z(from, day), end: Z(to, day) });
const closed = (day: number) => ({ kind: "closed", status: "UNAVAILABLE", label: "Unavailable", start: Z("00:00", day), end: Z("24:00", day) });

// Mon 9: free. Tue 10: closed all day. Sat 14: a confirmed 10:00-12:00 booking with setup and turnaround, a held 14:00-15:00 and
// a Maintenance block 15:30-17:00. Wed 11 08:00 to Fri 13 18:00: one Renovation block, cut by the service into two pieces, the
// second over a confirmed booking. Sun 15: a block running past midnight into Mon 16.
const week = [
  open(9),
  closed(10),
  { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("08:00", 11), end: Z("12:00", 12), reason_label: "Renovation", overlaps_confirmed_booking: false },
  { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("12:00", 12), end: Z("18:00", 13), reason_label: "Renovation", overlaps_confirmed_booking: true },
  open(14, "08:00", "09:30"),
  { kind: "setup", status: "CONFIRMED", label: "Confirmed", start: Z("09:30"), end: Z("10:00") },
  { kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("10:00"), end: Z("12:00"), occupied_start: Z("09:30"), occupied_end: Z("12:45") },
  { kind: "turnaround", status: "CONFIRMED", label: "Confirmed", start: Z("12:00"), end: Z("12:45") },
  open(14, "12:45", "14:00"),
  { kind: "event", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: Z("14:00"), end: Z("15:00") },
  open(14, "15:00", "15:30"),
  { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("15:30"), end: Z("17:00"), reason_label: "Maintenance", overlaps_confirmed_booking: false },
  open(14, "17:00", "22:00"),
  { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("22:00", 15), end: Z("02:00", 16), reason_label: "Other" },
];
const orchid = venueFixture({ periods: week }) as unknown as CalendarVenue;
const day = (date: string) => document.querySelector(`[data-day="${date}"]`) as HTMLElement;
const showWeek = (onOpenDay = vi.fn()) =>
  render(<VenueWeekGrid venues={[orchid]} from="2026-11-09" to="2026-11-15" today="2026-11-14" onOpenDay={onOpenDay} />);

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-130 week view (Figma 09a)", () => {
  it("SCRUM-130 heads each day with its weekday and date, and tints today's column", () => {
    showWeek();
    const region = screen.getByRole("region", { name: "Venue week from 2026-11-09 to 2026-11-15" });
    expect(within(region).getByText("MON")).toBeTruthy();
    expect(within(region).getByText("9 Nov")).toBeTruthy();
    expect(document.querySelector("[data-today]")?.textContent).toBe("SAT14 Nov");
    expect(day("2026-11-14").className).toContain("bg-status-info");
  });

  it("SCRUM-130/AC1 draws the occupied hours of a day in its bar: the booking, its setup and turnaround, the hold and the block", () => {
    showWeek();
    const bar = day("2026-11-14").querySelector("[data-bar]") as HTMLElement;
    const segment = (kind: string) => bar.querySelector(`[data-kind="${kind}"]`) as HTMLElement;
    // 08:00 to 22:00 is 14 hours: setup starts 1.5 h in, the turnaround ends 4.75 h in
    expect(parseFloat(segment("setup").style.left)).toBeCloseTo((1.5 / 14) * 100);
    expect(segment("setup").className).toContain("bg-border-strong");
    expect(segment("turnaround").className).toContain("bg-border-strong");
    expect(bar.querySelectorAll('[data-kind="event"]')[0].className).toContain("bg-status-success-fg");
    expect(bar.querySelectorAll('[data-kind="event"]')[1].className).toContain("bg-status-info-fg");
    expect(segment("block").className).toContain("bg-status-neutral-fg");
    expect(day("2026-11-09").querySelector("[data-bar]")?.children).toHaveLength(0);
  });

  it("SCRUM-130/AC6 lists a day's bookings and single-day blocks as chips with an icon, their status in words and their times", () => {
    showWeek();
    const chips = within(day("2026-11-14")).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["Confirmed10:00–12:00", "Tentatively Held14:00–15:00", "Blocked: Maintenance15:30–17:00"]);
    for (const chip of chips) expect(chip.querySelector("svg")).not.toBeNull();
    expect(chips[1].className).toContain("border-dashed"); // a hold is dashed, as Requested is in the mock-up
    expect(chips[2].className).toContain("calendar-block");
  });

  it("SCRUM-130 says when a day is free, with its opening hours, and when it is closed", () => {
    showWeek();
    expect(day("2026-11-09").textContent).toBe("Available08:00–22:00");
    expect(day("2026-11-10").textContent).toBe("ClosedOutside operating hours");
    expect(day("2026-11-10").className).toContain("bg-muted");
  });

  it("SCRUM-130/AC2 draws a block over several days once, as a banner across them, with its reason, its times and the conflict", () => {
    showWeek();
    const banners = document.querySelectorAll("[data-banner]");
    expect(banners).toHaveLength(1); // Wed to Fri; the Sunday-night block touches only Sunday in this week, so it is a chip
    const [renovation] = [...banners] as HTMLElement[];
    // Wed (index 2) to Fri (index 4) of seven days
    expect(parseFloat(renovation.style.left)).toBeCloseTo((2 / 7) * 100);
    expect(parseFloat(renovation.style.width)).toBeCloseTo((3 / 7) * 100);
    expect(renovation.textContent).toContain("Blocked · Renovation");
    expect(renovation.textContent).toContain("11 Nov 08:00 – 13 Nov 18:00");
    expect(renovation.textContent).toContain("Overlaps a confirmed booking");
    expect(within(renovation).getByRole("button").className).toContain("bg-status-danger");
    // the days under it show only their bars
    expect(day("2026-11-12").textContent).toBe("");
    expect(day("2026-11-15").textContent).toBe("Blocked: Other22:00–24:00");
  });

  it("SCRUM-130/AC1 opens the details of a booking: status, when it is held, setup, turnaround and the next free window", async () => {
    const onOpenDay = vi.fn();
    showWeek(onOpenDay);
    fireEvent.click(screen.getByRole("button", { name: "Details: Confirmed, Orchid Hall, Sat 14 Nov" }));
    const details = await screen.findByLabelText("Availability details");
    expect(within(details).getByText("Orchid Hall")).toBeTruthy();
    expect(within(details).getByText("1 Marina Boulevard · Max capacity 150")).toBeTruthy();
    expect(within(details).getByText("Confirmed")).toBeTruthy();
    const row = (term: string) => within(details).getByText(term).nextElementSibling?.textContent;
    expect(row("Held")).toBe("Sat 14 Nov, 10:00–12:00");
    expect(row("Setup")).toBe("09:30–10:00");
    expect(row("Turnaround")).toBe("12:00–12:45");
    expect(row("Next free window")).toBe("12:45–14:00");

    fireEvent.click(within(details).getByRole("button", { name: "Open day view" }));
    expect(onOpenDay).toHaveBeenCalledWith("2026-11-14");
    await waitFor(() => expect(screen.queryByLabelText("Availability details")).toBeNull());
  });

  it("SCRUM-130/AC2 opens the details of a block: its reason, when it starts and ends, and the conflict; Close shuts them", async () => {
    showWeek();
    fireEvent.click(screen.getByRole("button", { name: /^Details: Blocked: Renovation, Orchid Hall, Wed 11 Nov/ }));
    const details = await screen.findByLabelText("Availability details");
    const row = (term: string) => within(details).getByText(term).nextElementSibling?.textContent;
    expect(row("Reason")).toBe("Renovation");
    expect(row("Starts")).toBe("2026-11-11 08:00");
    expect(row("Ends")).toBe("2026-11-13 18:00");
    expect(row("Note")).toBe("Conflicts with a confirmed booking");
    expect(within(details).getByText("Blocked · conflict")).toBeTruthy();
    fireEvent.click(within(details).getByRole("button", { name: "Close details" }));
    await waitFor(() => expect(screen.queryByLabelText("Availability details")).toBeNull());
  });

  it("SCRUM-130 gives a block with no reason, no setup and no free time after it only the rows it has", async () => {
    const bare = venueFixture({
      periods: [
        { kind: "event", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: Z("20:00"), end: Z("22:00") },
        { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("08:00"), end: Z("09:00") },
      ],
    }) as unknown as CalendarVenue;
    render(<VenueWeekGrid venues={[bare]} from="2026-11-09" to="2026-11-15" today="2026-11-14" onOpenDay={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Details: Tentatively Held/ }));
    let details = await screen.findByLabelText("Availability details");
    expect(within(details).queryByText("Setup")).toBeNull();
    expect(within(details).queryByText("Next free window")).toBeNull();
    fireEvent.click(within(details).getByRole("button", { name: "Close details" }));
    await waitFor(() => expect(screen.queryByLabelText("Availability details")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /^Details: Blocked, / }));
    details = await screen.findByLabelText("Availability details");
    expect(within(details).queryByText("Reason")).toBeNull();
    expect(within(details).queryByText("Note")).toBeNull();
  });

  it("SCRUM-130 shows the week grid from the page, explains the bar, and opens a day from a period", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ venues: [orchid] }))));
    render(<VenueCalendar now={new Date(Z("10:15"))} />);
    await screen.findByText("Orchid Hall");
    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    expect(await screen.findByRole("region", { name: "Venue week from 2026-11-09 to 2026-11-15" })).toBeTruthy();
    expect(screen.getByText(/The bar at the top of each day shows occupied hours from 08:00 to 22:00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Details: Confirmed, Orchid Hall, Sat 14 Nov" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open day view" }));
    expect(await screen.findByRole("region", { name: "Venue timeline for 2026-11-14" })).toBeTruthy();
  });
});

describe("SCRUM-130 month view", () => {
  it("SCRUM-130 draws runs of booked, held or blocked days as one bar, leaves free days empty and closed days grey", async () => {
    const onOpenDay = vi.fn();
    const shut = venueFixture({ id: "x", name: "Shut Room", periods: [closed(1)] }) as unknown as CalendarVenue;
    const free = venueFixture({ id: "f", name: "Free Room", periods: [open(1)] }) as unknown as CalendarVenue;
    render(<VenueMonthGrid venues={[orchid, shut, free]} from="2026-11-01" to="2026-11-30" today="2026-11-14" onOpenDay={onOpenDay} />);
    const button = (name: string) => screen.getByRole("button", { name });
    // Wed 11 is blocked; Thu 12 to Fri 13 is the same block over a confirmed booking; Sat 14 to Mon 16 is blocked again
    const plain = button("Details: Orchid Hall, Blocked, Wed 11 Nov");
    const conflict = button("Details: Orchid Hall, Blocked (conflict), Thu 12 Nov to Fri 13 Nov");
    const run = button("Details: Orchid Hall, Blocked, Sat 14 Nov to Mon 16 Nov");
    expect(plain.className).toContain("calendar-block");
    expect(conflict.className).toContain("bg-status-danger");
    expect(run.textContent).toBe("Blocked");
    expect(run.querySelector("svg")).not.toBeNull();
    expect(parseFloat((run.parentElement as HTMLElement).style.width)).toBeCloseTo((3 / 30) * 100);
    expect(document.querySelectorAll("[data-run]")).toHaveLength(3);
    // free and closed days have no bar: their word is for screen readers only
    expect(within(button("Details: Free Room on Sun 1 Nov: Free")).getByText("Free").className).toContain("sr-only");
    expect(button("Details: Shut Room on Sun 1 Nov: Closed").className).toContain("bg-muted");
    expect(screen.getByText("14").className).toContain("font-bold"); // today

    fireEvent.click(run);
    const details = await screen.findByLabelText("Availability details");
    const row = (term: string) => within(details).getByText(term).nextElementSibling?.textContent;
    expect(row("Days")).toBe("Sat 14 Nov – Mon 16 Nov");
    expect(row("Confirmed")).toBe("14 Nov 10:00 – 14 Nov 12:00");
    expect(row("Blocked: Maintenance")).toBe("14 Nov 15:30 – 14 Nov 17:00");
    expect(row("Blocked: Other")).toBe("15 Nov 22:00 – 16 Nov 02:00");
    fireEvent.click(within(details).getByRole("button", { name: "Open day view" }));
    expect(onOpenDay).toHaveBeenCalledWith("2026-11-14");
  });

  it("SCRUM-130 stacks the icon over the word on a one-day bar, and calls a conflict run a conflict in its details", async () => {
    render(<VenueMonthGrid venues={[orchid]} from="2026-11-01" to="2026-11-30" today="2026-11-14" onOpenDay={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Details: Orchid Hall, Blocked, Wed 11 Nov" }).className).toContain("flex-col");
    fireEvent.click(screen.getByRole("button", { name: "Details: Orchid Hall, Blocked (conflict), Thu 12 Nov to Fri 13 Nov" }));
    expect(within(await screen.findByLabelText("Availability details")).getByText("Blocked · conflict")).toBeTruthy();
  });

  it("SCRUM-130 shows the month grid from the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ venues: [orchid] }))));
    render(<VenueCalendar now={new Date(Z("10:15"))} />);
    await screen.findByText("Orchid Hall");
    fireEvent.click(screen.getByRole("tab", { name: "Month" }));
    expect(await screen.findByRole("region", { name: "Venue month from 2026-11-01 to 2026-11-30" })).toBeTruthy();
  });
});

describe("SCRUM-130 week view review gaps", () => {
  it("SCRUM-130/AC2 marks a one-day block over a confirmed booking in red with a warning, and a plain multi-day block in grey", () => {
    const v = venueFixture({
      periods: [
        { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("09:00", 9), end: Z("11:00", 9), reason_label: "Safety restriction", overlaps_confirmed_booking: true },
        { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("08:00", 11), end: Z("18:00", 12) },
      ],
    }) as unknown as CalendarVenue;
    render(<VenueWeekGrid venues={[v]} from="2026-11-09" to="2026-11-15" today="2026-11-14" onOpenDay={vi.fn()} />);
    const chip = within(day("2026-11-09")).getByRole("button");
    expect(chip.className).toContain("bg-status-danger");
    expect(chip.textContent).toBe("Blocked: Safety restriction09:00–11:00");
    const banner = document.querySelector("[data-banner]") as HTMLElement;
    expect(within(banner).getByRole("button").className).toContain("bg-status-neutral");
    expect(banner.textContent).toBe("Blocked11 Nov 08:00 – 12 Nov 18:00");
  });
});

describe("SCRUM-130 month runs of bookings", () => {
  it("SCRUM-130 draws booked days green and held days teal, each run as one bar", () => {
    const v = venueFixture({
      periods: [
        { kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("10:00", 2), end: Z("12:00", 2) },
        { kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("10:00", 3), end: Z("12:00", 3) },
        { kind: "event", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: Z("10:00", 4), end: Z("12:00", 4) },
      ],
    }) as unknown as CalendarVenue;
    render(<VenueMonthGrid venues={[v]} from="2026-11-01" to="2026-11-30" today="2026-11-14" onOpenDay={vi.fn()} />);
    const booked = screen.getByRole("button", { name: "Details: Orchid Hall, Booked, Mon 2 Nov to Tue 3 Nov" });
    expect(booked.className).toContain("bg-status-success");
    expect(booked.className).toContain("border-status-success-fg");
    const held = screen.getByRole("button", { name: "Details: Orchid Hall, Held, Wed 4 Nov" });
    expect(held.className).toContain("bg-status-info");
    expect(held.className).toContain("border-status-info-fg");
  });
});
