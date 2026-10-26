import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VenueCalendarVenue } from "@/components/venue-calendar/VenueCalendarVenue";
import { formatPeriodTimes, type CalendarVenue } from "@/lib/venueCalendar";
import { venueFixture } from "./venue-calendar-fixtures";

// 14 Nov 2026, Singapore time (UTC+8): 10:00 is 02:00Z. Orchid Hall: 30 minutes setup, 45 turnaround.
const at = (hhmm: string) => `2026-11-14T${hhmm}:00.000Z`;
const p = (kind: string, status: string, label: string, from: string, to: string, more: Record<string, unknown> = {}) => ({
  kind, status, label, start: at(from), end: at(to), ...more,
});

function show(periods: unknown[]) {
  render(<VenueCalendarVenue venue={venueFixture({ periods }) as unknown as CalendarVenue} />);
  return screen.getAllByRole("listitem");
}

describe("SCRUM-84/AC2 held, confirmed and blocked periods", () => {
  it("SCRUM-84/AC2 labels a held, a confirmed and a blocked period in text, each with its start and end", () => {
    const items = show([
      p("event", "TENTATIVELY_HELD", "Tentatively Held", "02:00", "04:00"),
      p("event", "CONFIRMED", "Confirmed", "05:00", "06:00"),
      p("block", "BLOCKED", "Blocked", "07:00", "09:00", { reason: "maintenance", reason_label: "Maintenance", overlaps_confirmed_booking: false }),
    ]);
    expect(within(items[0]).getByText("Tentatively Held")).toBeTruthy();
    expect(items[0].textContent).toContain("2026-11-14 10:00 to 12:00");
    expect(within(items[1]).getByText("Confirmed")).toBeTruthy();
    expect(items[1].textContent).toContain("2026-11-14 13:00 to 14:00");
    expect(within(items[2]).getByText("Blocked")).toBeTruthy();
    expect(items[2].textContent).toContain("2026-11-14 15:00 to 17:00");
  });

  it("SCRUM-84/AC2 shows the reason of a block as text", () => {
    const items = show([p("block", "BLOCKED", "Blocked", "07:00", "09:00", { reason: "renovation", reason_label: "Renovation", overlaps_confirmed_booking: false })]);
    expect(within(items[0]).getByText("Renovation")).toBeTruthy();
  });

  it("SCRUM-84/AC2 shows setup and turnaround apart from the event, each named in text", () => {
    const items = show([
      p("setup", "CONFIRMED", "Confirmed", "01:30", "02:00"),
      p("event", "CONFIRMED", "Confirmed", "02:00", "04:00"),
      p("turnaround", "CONFIRMED", "Confirmed", "04:00", "04:45"),
    ]);
    expect(within(items[0]).getByText("Setup")).toBeTruthy();
    expect(within(items[1]).getByText("Event")).toBeTruthy();
    expect(within(items[2]).getByText("Turnaround")).toBeTruthy();
    expect(items.map((i) => i.getAttribute("data-kind"))).toEqual(["setup", "event", "turnaround"]);
    // distinct look: setup and turnaround are dashed, the event is not
    expect(items[0].className).toContain("border-dashed");
    expect(items[2].className).toContain("border-dashed");
    expect(items[1].className).not.toContain("border-dashed");
  });

  it("SCRUM-84/AC2 flags a block that lies over a confirmed booking, and only that stretch", () => {
    const items = show([
      p("block", "BLOCKED", "Blocked", "01:00", "01:30", { reason: "maintenance", reason_label: "Maintenance", overlaps_confirmed_booking: false }),
      p("block", "BLOCKED", "Blocked", "01:30", "04:45", { reason: "maintenance", reason_label: "Maintenance", overlaps_confirmed_booking: true }),
    ]);
    expect(within(items[0]).queryByText("Conflicts with a confirmed booking")).toBeNull();
    expect(within(items[1]).getByText("Conflicts with a confirmed booking")).toBeTruthy();
    expect(within(items[1]).getByText("Blocked")).toBeTruthy();
  });

  it("SCRUM-84/AC2 shows a period that crosses midnight with both dates, and ignores fields it does not know", () => {
    const items = show([{ ...p("event", "CONFIRMED", "Confirmed", "15:00", "18:00"), end: "2026-11-15T02:00:00.000Z", brand_new_field: 1 }]);
    expect(items[0].textContent).toContain("2026-11-14 23:00 to 2026-11-15 10:00");
  });
});

describe("SCRUM-84/AC2 formatPeriodTimes", () => {
  it("shows the end alone when it is on the same Singapore day", () => {
    expect(formatPeriodTimes(at("02:00"), at("04:00"))).toBe("2026-11-14 10:00 to 12:00");
  });
});
