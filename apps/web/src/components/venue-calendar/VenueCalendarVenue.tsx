"use client";

import { useState } from "react";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { VenueCalendarDetails } from "./VenueCalendarDetails";
import { VenueCalendarPeriod } from "./VenueCalendarPeriod";

// SCRUM-84/AC1: one venue with its periods, in time order as the service sends them. SCRUM-85: choosing a period opens its details.
export function VenueCalendarVenue({ venue }: { venue: CalendarVenue }) {
  const headingId = `venue-calendar-${venue.id}`;
  const [selected, setSelected] = useState<string | null>(null);
  const keyOf = (period: CalendarVenue["periods"][number]) => `${period.start}-${period.kind}`;
  const chosen = venue.periods.find((period) => keyOf(period) === selected);
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
          <VenueCalendarPeriod key={keyOf(period)} period={period} selected={keyOf(period) === selected} onSelect={() => setSelected(keyOf(period))} />
        ))}
      </ul>
      {chosen && <VenueCalendarDetails venue={venue} period={chosen} onClose={() => setSelected(null)} />}
    </section>
  );
}
