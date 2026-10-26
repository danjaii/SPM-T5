import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VenueCalendarVenue } from "@/components/venue-calendar/VenueCalendarVenue";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { venueFixture } from "./venue-calendar-fixtures";

// Orchid Hall open 08:00 to 22:00 Singapore time on 14 Nov 2026 (00:00 is 16:00Z the day before).
const hours = [
  { kind: "closed", status: "UNAVAILABLE", label: "Unavailable", start: "2026-11-13T16:00:00.000Z", end: "2026-11-14T00:00:00.000Z" },
  { kind: "open", status: "AVAILABLE", label: "Available", start: "2026-11-14T00:00:00.000Z", end: "2026-11-14T14:00:00.000Z" },
  { kind: "closed", status: "UNAVAILABLE", label: "Unavailable", start: "2026-11-14T14:00:00.000Z", end: "2026-11-14T16:00:00.000Z" },
];
const show = (changes: Record<string, unknown>) => {
  render(<VenueCalendarVenue venue={venueFixture(changes) as unknown as CalendarVenue} />);
  return screen.getAllByRole("listitem");
};

describe("SCRUM-84/AC3 free time inside operating hours is Available", () => {
  it("SCRUM-84/AC3 labels it 'Available' with its start and end", () => {
    const items = show({ operating_hours: { start: "08:00", end: "22:00" }, periods: hours });
    expect(within(items[1]).getByText("Available")).toBeTruthy();
    expect(items[1].textContent).toContain("2026-11-14 08:00 to 22:00");
  });

  it("SCRUM-84/AC3 says so when a venue has no operating hours limit", () => {
    show({ operating_hours: null });
    expect(screen.getByText("Open at any time")).toBeTruthy();
  });
});

describe("SCRUM-84/AC4 time outside operating hours is Unavailable", () => {
  it("SCRUM-84/AC4 labels it 'Unavailable' before opening and after closing", () => {
    const items = show({ operating_hours: { start: "08:00", end: "22:00" }, periods: hours });
    expect(within(items[0]).getByText("Unavailable")).toBeTruthy();
    expect(items[0].textContent).toContain("2026-11-14 00:00");
    expect(within(items[2]).getByText("Unavailable")).toBeTruthy();
    expect(items[2].textContent).toContain("2026-11-14 22:00 to 2026-11-15 00:00");
  });

  it("SCRUM-84/AC4 shows the venue's operating hours, so a viewer sees why", () => {
    show({ operating_hours: { start: "08:00", end: "22:00" }, periods: hours });
    expect(screen.getByText("Open 08:00 to 22:00")).toBeTruthy();
  });

  it("SCRUM-84/AC4 never calls a block 'Unavailable'", () => {
    const items = show({
      periods: [{ kind: "block", status: "BLOCKED", label: "Blocked", start: "2026-11-14T02:00:00.000Z", end: "2026-11-14T10:00:00.000Z", reason: "other", reason_label: "Other", overlaps_confirmed_booking: false }],
    });
    expect(within(items[0]).queryByText("Unavailable")).toBeNull();
    expect(within(items[0]).getByText("Blocked")).toBeTruthy();
  });
});
