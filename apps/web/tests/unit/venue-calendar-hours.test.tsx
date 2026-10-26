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
