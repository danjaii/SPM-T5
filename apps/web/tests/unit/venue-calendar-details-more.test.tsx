// SCRUM-85: every block reason, a tentatively held period, and the setup rule with checks that cannot pass on an empty panel

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VenueDayView } from "@/components/venue-calendar/VenueDayTimeline";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { venueFixture } from "./venue-calendar-fixtures";

const Z = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 14, h - 8, m)).toISOString();
};
const show = (periods: unknown[]) => render(<VenueDayView venues={[venueFixture({ periods }) as unknown as CalendarVenue]} date="2026-11-14" />);
const details = () => screen.getByRole("region", { name: "Availability details" });

describe("SCRUM-85/AC3 every reason Venue Staff can record is shown", () => {
  it.each([
    ["maintenance", "Maintenance"], ["renovation", "Renovation"], ["safety_restriction", "Safety restriction"],
    ["internal_activity", "Internal activity"], ["other", "Other"],
  ])("SCRUM-85/AC3 shows %s as %s", (reason, label) => {
    show([{ kind: "block", status: "BLOCKED", label: "Blocked", start: Z("12:00"), end: Z("14:00"), reason, reason_label: label, overlaps_confirmed_booking: false }]);
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    expect(within(details()).getByText("Reason").nextElementSibling?.textContent).toBe(label);
  });
});

describe("SCRUM-85/AC1 a tentatively held period opens its details too", () => {
  it("SCRUM-85/AC1 shows the status Tentatively Held with its start and end", () => {
    show([{ kind: "event", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: Z("10:00"), end: Z("12:00"), event_start: Z("10:00"), event_end: Z("12:00"), occupied_start: Z("10:00"), occupied_end: Z("12:00") }]);
    fireEvent.click(screen.getByRole("button", { name: /Details/ }));
    const panel = within(details());
    expect(panel.getByText("Status").nextElementSibling?.textContent).toBe("Tentatively Held");
    expect(panel.getByText("Starts").nextElementSibling?.textContent).toBe("2026-11-14 10:00");
    expect(panel.getByText("Ends").nextElementSibling?.textContent).toBe("2026-11-14 12:00");
  });
});

describe("SCRUM-85/AC4 setup and turnaround are never called Available, and say what they are", () => {
  it("SCRUM-85/AC4 labels the opened setup period as setup and gives it a status that is not Available", () => {
    show([
      { kind: "setup", status: "CONFIRMED", label: "Confirmed", start: Z("09:30"), end: Z("10:00") },
      { kind: "event", status: "CONFIRMED", label: "Confirmed", start: Z("10:00"), end: Z("12:00"), event_start: Z("10:00"), event_end: Z("12:00"), occupied_start: Z("09:30"), occupied_end: Z("12:00") },
    ]);
    expect(document.querySelectorAll('[data-kind="setup"]').length).toBe(1);
    fireEvent.click(within(document.querySelector('[data-kind="setup"]') as HTMLElement).getByRole("button", { name: /Details/ }));
    const panel = within(details());
    expect(panel.getByText("What it is").nextElementSibling?.textContent).toMatch(/^Setup time for the booking that starts 2026-11-14 10:00/);
    expect(panel.getByText("Status").nextElementSibling?.textContent).toBe("Confirmed");
  });
});
