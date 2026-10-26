import type { CalendarRange } from "@spm-t5/shared";
import type { CalendarVenue } from "../readers/venueCalendarReader";

export type CalendarStatus = "TENTATIVELY_HELD" | "CONFIRMED" | "BLOCKED" | "AVAILABLE" | "UNAVAILABLE";

export const STATUS_LABELS: Record<CalendarStatus, string> = {
  TENTATIVELY_HELD: "Tentatively Held",
  CONFIRMED: "Confirmed",
  BLOCKED: "Blocked",
  AVAILABLE: "Available",
  UNAVAILABLE: "Unavailable",
};

export interface CalendarPeriod {
  kind: "open" | "closed" | "event" | "setup" | "turnaround" | "block";
  status: CalendarStatus;
  label: string;
  start: string;
  end: string;
}

export interface CalendarVenueView {
  id: string;
  name: string;
  address: string;
  max_capacity: number;
  periods: CalendarPeriod[];
}

/** SCRUM-84: every venue with periods that cover the range. */
export function buildCalendar(venues: CalendarVenue[], range: CalendarRange): CalendarVenueView[] {
  return [...venues]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((v) => ({
      id: v.id,
      name: v.name,
      address: v.address,
      max_capacity: v.maxCapacity,
      periods: [
        { kind: "open", status: "AVAILABLE", label: STATUS_LABELS.AVAILABLE, start: range.start.toISOString(), end: range.end.toISOString() },
      ],
    }));
}
