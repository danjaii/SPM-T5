// SCRUM-130/AC1 to AC3: the calendar as a week grid per venue (days across, hours down) on wide screens, with the list as the narrow fallback.
// 14 Nov 2026 is a Saturday in Singapore (UTC+8); the week shown is Monday 9 to Sunday 15 Nov.

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VenueWeekGrid } from "@/components/venue-calendar/VenueWeekGrid";
import { VenueCalendarVenue } from "@/components/venue-calendar/VenueCalendarVenue";
import { useMediaQuery } from "@/lib/useMediaQuery";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { venueFixture } from "./venue-calendar-fixtures";

const Z = (date: string, hhmm: string) => new Date(Date.parse(`${date}T${hhmm}:00.000Z`) - 8 * 3_600_000).toISOString();
const WEEK = { from: "2026-11-09", to: "2026-11-15" };

const booked = venueFixture({
  periods: [
    { kind: "setup", status: "CONFIRMED", label: "Confirmed", start: Z("2026-11-14", "09:30"), end: Z("2026-11-14", "10:00") },
    { kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("2026-11-14", "10:00"), end: Z("2026-11-14", "12:00"), event_start: Z("2026-11-14", "10:00"), event_end: Z("2026-11-14", "12:00"), occupied_start: Z("2026-11-14", "09:30"), occupied_end: Z("2026-11-14", "12:45"), setup_minutes: 30, turnaround_minutes: 45 },
    { kind: "turnaround", status: "CONFIRMED", label: "Confirmed", start: Z("2026-11-14", "12:00"), end: Z("2026-11-14", "12:45") },
    { kind: "event", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: Z("2026-11-11", "14:00"), end: Z("2026-11-11", "16:00"), event_start: Z("2026-11-11", "14:00"), event_end: Z("2026-11-11", "16:00") },
    { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("2026-11-12", "08:00"), end: Z("2026-11-12", "18:00"), reason: "maintenance", reason_label: "Maintenance", overlaps_confirmed_booking: false },
    { kind: "open", status: "AVAILABLE", label: "Available", start: Z("2026-11-13", "08:00"), end: Z("2026-11-13", "20:00") },
    { kind: "closed", status: "UNAVAILABLE", label: "Unavailable", start: Z("2026-11-13", "20:00"), end: Z("2026-11-13", "22:00") },
  ],
}) as unknown as CalendarVenue;

const week = () => screen.getByRole("region", { name: /Orchid Hall, week of/ });
const day = (name: string) => within(week()).getByRole("group", { name });
const blockIn = (column: HTMLElement, name: RegExp) => within(column).getByRole("button", { name });

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-130/AC1 a week grid per venue: days across, hours down", () => {
  it("SCRUM-130/AC1 has one column per day of the week, named with its weekday and date, and the venue's details above", () => {
    render(<VenueWeekGrid venue={booked} range={WEEK} />);

    expect(screen.getByRole("heading", { name: "Orchid Hall" })).toBeTruthy();
    expect(screen.getByText(/1 Marina Boulevard · Capacity 150/)).toBeTruthy();
    const names = within(week()).getAllByRole("group").map((g) => g.getAttribute("aria-label"));
    expect(names).toEqual(["Mon 9 Nov", "Tue 10 Nov", "Wed 11 Nov", "Thu 12 Nov", "Fri 13 Nov", "Sat 14 Nov", "Sun 15 Nov"]);
  });

  it("SCRUM-130/AC1 labels the hours down the side", () => {
    render(<VenueWeekGrid venue={booked} range={WEEK} />);
    const hours = within(week()).getByTestId("hour-labels").textContent ?? "";
    expect(hours).toContain("06:00");
    expect(hours).toContain("12:00");
    expect(hours).toContain("22:00");
  });

  it("SCRUM-130/AC1 puts each period in its own day's column, at its time and with its length", () => {
    render(<VenueWeekGrid venue={booked} range={WEEK} />);

    const saturday = day("Sat 14 Nov");
    const event = blockIn(saturday, /Details: Confirmed, 2026-11-14 10:00 to 12:00/).closest("[data-block]") as HTMLElement;
    // 10:00 is 4 hours into a 06:00 to 22:00 column, and it lasts 2 hours
    expect(event.style.top).toBe("25%");
    expect(event.style.height).toBe("12.5%");
    expect(within(day("Wed 11 Nov")).getByRole("button", { name: /Tentatively Held/ })).toBeTruthy();
    expect(within(day("Thu 12 Nov")).getByRole("button", { name: /Blocked/ })).toBeTruthy();
    expect(within(saturday).queryByRole("button", { name: /Tentatively Held/ })).toBeNull();
  });

  it("SCRUM-130/AC1 shows setup and turnaround dashed and named, and the event itself solid", () => {
    render(<VenueWeekGrid venue={booked} range={WEEK} />);
    const saturday = day("Sat 14 Nov");

    const setup = blockIn(saturday, /Details: Confirmed, 2026-11-14 09:30 to 10:00/).closest("[data-block]") as HTMLElement;
    const turnaround = blockIn(saturday, /Details: Confirmed, 2026-11-14 12:00 to 12:45/).closest("[data-block]") as HTMLElement;
    const event = blockIn(saturday, /Details: Confirmed, 2026-11-14 10:00 to 12:00/).closest("[data-block]") as HTMLElement;
    expect(setup.className).toContain("border-dashed");
    expect(turnaround.className).toContain("border-dashed");
    expect(event.className).not.toContain("border-dashed");
    expect(setup.textContent).toContain("Setup");
    expect(turnaround.textContent).toContain("Turnaround");
    expect(event.textContent).toContain("Event");
  });

  it.each([
    ["Wed 11 Nov", "Tentatively Held"], ["Sat 14 Nov", "Confirmed"], ["Thu 12 Nov", "Blocked"], ["Fri 13 Nov", "Available"],
  ])("SCRUM-130/AC5 shows a %s block as an icon and the words %s, not colour alone", (col, label) => {
    render(<VenueWeekGrid venue={booked} range={WEEK} />);
    const block = within(day(col)).getAllByRole("button", { name: new RegExp(`Details: ${label}`) })[0].closest("[data-block]") as HTMLElement;
    expect(block.textContent).toContain(label);
    expect(block.querySelector("svg")).not.toBeNull();
  });

  it("SCRUM-130/AC5 shows time outside operating hours as Unavailable with its icon and words", () => {
    render(<VenueWeekGrid venue={booked} range={WEEK} />);
    const block = within(day("Fri 13 Nov")).getByRole("button", { name: /Details: Unavailable/ }).closest("[data-block]") as HTMLElement;
    expect(block.textContent).toContain("Unavailable");
    expect(block.querySelector("svg")).not.toBeNull();
  });

  it("SCRUM-130/AC1 shows a longer range as one grid per week", () => {
    render(<VenueWeekGrid venue={booked} range={{ from: "2026-11-09", to: "2026-11-18" }} />);
    expect(screen.getAllByRole("region", { name: /Orchid Hall, week of/ })).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Orchid Hall, week of Mon 16 Nov" })).toBeTruthy();
  });
});

describe("SCRUM-130/AC2 a Blocked period is striped, with its reason on hover, tap and keyboard focus", () => {
  const reasonButton = () => screen.getByRole("button", { name: /why is this blocked/i });

  it("SCRUM-130/AC2 draws the block with the stripe pattern and the word Blocked, so it is not colour alone", () => {
    render(<VenueWeekGrid venue={booked} range={WEEK} />);
    const block = within(day("Thu 12 Nov")).getByRole("button", { name: /Details: Blocked/ }).closest("[data-block]") as HTMLElement;
    expect(block.className).toContain("calendar-block");
    expect(block.textContent).toContain("Blocked");
  });

  it("SCRUM-130/AC2 shows the reason on hover, on keyboard focus and on tap, and Escape closes it", () => {
    render(<VenueWeekGrid venue={booked} range={WEEK} />);

    fireEvent.mouseEnter(reasonButton());
    expect(screen.getByRole("tooltip").textContent).toBe("Blocked: Maintenance");
    fireEvent.mouseLeave(reasonButton());
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.focus(reasonButton());
    expect(screen.getByRole("tooltip").textContent).toBe("Blocked: Maintenance");
    fireEvent.blur(reasonButton());
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.click(reasonButton());
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.keyDown(reasonButton(), { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("SCRUM-130/AC2 says so, in words and with an icon, when a block lies over a confirmed booking (the grid's Conflict marker)", () => {
    const over = venueFixture({ periods: [{ kind: "block", status: "BLOCKED", label: "Blocked", start: Z("2026-11-12", "08:00"), end: Z("2026-11-12", "18:00"), reason: "maintenance", reason_label: "Maintenance", overlaps_confirmed_booking: true }] }) as unknown as CalendarVenue;
    const { unmount } = render(<VenueWeekGrid venue={over} range={WEEK} />);
    const flagged = within(day("Thu 12 Nov")).getByText("Conflicts with a confirmed booking");
    expect(flagged.closest("[data-block]")?.querySelector("svg")).not.toBeNull();
    unmount();

    render(<VenueWeekGrid venue={booked} range={WEEK} />);
    expect(screen.queryByText("Conflicts with a confirmed booking")).toBeNull();
  });

  it("SCRUM-130/AC2 has the hint only on a block", () => {
    render(<VenueWeekGrid venue={booked} range={WEEK} />);
    expect(screen.getAllByRole("button", { name: /why is this blocked/i })).toHaveLength(1);
  });
});

describe("SCRUM-85 Details still work from the grid", () => {
  it("SCRUM-130/AC1 opens the availability details of the chosen block, and closes them again", () => {
    render(<VenueWeekGrid venue={booked} range={WEEK} />);

    fireEvent.click(blockIn(day("Sat 14 Nov"), /Details: Confirmed, 2026-11-14 10:00 to 12:00/));

    const panel = within(screen.getByRole("region", { name: "Availability details" }));
    expect(panel.getByText("Starts").nextElementSibling?.textContent).toBe("2026-11-14 10:00");
    expect(panel.getByText("Ends").nextElementSibling?.textContent).toBe("2026-11-14 12:00");
    expect(panel.getByText(/Capacity 150/)).toBeTruthy();
    fireEvent.click(panel.getByRole("button", { name: /Close details/ }));
    expect(screen.queryByRole("region", { name: "Availability details" })).toBeNull();
  });

  it("SCRUM-130/AC1 shows the free window and the block's reason in the details", () => {
    render(<VenueWeekGrid venue={booked} range={WEEK} />);
    fireEvent.click(within(day("Fri 13 Nov")).getByRole("button", { name: /Details: Available/ }));
    expect(within(screen.getByRole("region", { name: "Availability details" })).getByText("Free window")).toBeTruthy();
    fireEvent.click(within(day("Thu 12 Nov")).getByRole("button", { name: /Details: Blocked/ }));
    expect(within(screen.getByRole("region", { name: "Availability details" })).getByText("Reason").nextElementSibling?.textContent).toBe("Maintenance");
  });
});

describe("SCRUM-130/AC3 Mark unavailable from the grid", () => {
  it("SCRUM-130/AC3 offers it only when the page gives it, and calls it for this venue", () => {
    const onMark = vi.fn();
    const { rerender } = render(<VenueWeekGrid venue={booked} range={WEEK} />);
    expect(screen.queryByRole("button", { name: /Mark Orchid Hall unavailable/ })).toBeNull();

    rerender(<VenueWeekGrid venue={booked} range={WEEK} onMarkUnavailable={onMark} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Orchid Hall unavailable" }));
    expect(onMark).toHaveBeenCalledTimes(1);
  });
});

describe("SCRUM-130/AC7 the list stays as the fallback on a narrow screen", () => {
  function setMatchMedia(matches: boolean) {
    const asked: string[] = [];
    vi.stubGlobal("matchMedia", (query: string) => {
      asked.push(query);
      return { matches, media: query, addEventListener: () => undefined, removeEventListener: () => undefined };
    });
    return asked;
  }
  function Pick() {
    const wide = useMediaQuery("(min-width: 640px)");
    return wide ? <VenueWeekGrid venue={booked} range={WEEK} /> : <VenueCalendarVenue venue={booked} />;
  }

  it("SCRUM-130/AC7 asks whether the screen is at least 640 px wide, and shows the grid when it is", () => {
    const asked = setMatchMedia(true);
    render(<Pick />);
    expect(asked).toContain("(min-width: 640px)");
    expect(screen.getByRole("region", { name: /Orchid Hall, week of/ })).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("SCRUM-130/AC7 shows the list, one row per period, and no grid when it is narrower (375 px)", () => {
    setMatchMedia(false);
    render(<Pick />);
    expect(screen.queryByRole("region", { name: /week of/ })).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
  });

  it("SCRUM-130/AC7 shows the list when the browser cannot answer media queries at all", () => {
    render(<Pick />);
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
  });
});

describe("SCRUM-130/AC8 keyboard", () => {
  it("SCRUM-130/AC8 makes the scrolling week reachable by Tab, and every block and control a real button with a focus ring", () => {
    render(<VenueWeekGrid venue={booked} range={WEEK} onMarkUnavailable={() => undefined} />);

    expect(week().tabIndex).toBe(0);
    expect(week().className).toMatch(/focus-visible:ring/);
    for (const button of screen.getAllByRole("button")) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.className).toMatch(/focus-visible:(ring|border)/);
    }
  });
});
