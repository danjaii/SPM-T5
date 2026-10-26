import type { CalendarVenue } from "@/lib/venueCalendar";
import { VenueCalendarPeriod } from "./VenueCalendarPeriod";

// SCRUM-84/AC1: one venue with its periods, in time order as the service sends them.
export function VenueCalendarVenue({ venue }: { venue: CalendarVenue }) {
  const headingId = `venue-calendar-${venue.id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-lg font-bold text-foreground">{venue.name}</h2>
        <p className="text-sm text-muted-foreground">{venue.address} · Capacity {venue.max_capacity}</p>
        <p className="text-sm text-muted-foreground">
          {venue.operating_hours ? `Open ${venue.operating_hours.start} to ${venue.operating_hours.end}` : "Open at any time"}
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {venue.periods.map((period) => (
          <VenueCalendarPeriod key={`${period.start}-${period.kind}`} period={period} />
        ))}
      </ul>
    </section>
  );
}
