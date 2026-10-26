import type { CalendarPeriod } from "@/lib/venueCalendar";

// SCRUM-84/AC1: one period of a venue. Jerome: this is the one place that decides how a period looks.
export function VenueCalendarPeriod({ period }: { period: CalendarPeriod }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
      <span className="font-semibold">{period.label}</span>
    </li>
  );
}
