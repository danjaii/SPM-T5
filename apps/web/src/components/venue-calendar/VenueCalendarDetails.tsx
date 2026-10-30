import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPeriodInstant, type CalendarPeriod, type CalendarVenue } from "@/lib/venueCalendar";

/** The line (or lines) that say what is special about this kind of period. */
function kindLines(period: CalendarPeriod, periods: CalendarPeriod[]): { term: string; text: string }[] {
  switch (period.kind) {
    case "open":
      // SCRUM-85/AC2: the whole continuous free window
      return [{ term: "Free window", text: `Free from ${formatPeriodInstant(period.start)} until ${formatPeriodInstant(period.end)}` }];
    case "block":
      // SCRUM-85/AC3: the reason Venue Staff recorded
      return [
        ...(period.reason_label ? [{ term: "Reason", text: period.reason_label }] : []),
        ...(period.overlaps_confirmed_booking ? [{ term: "Note", text: "Conflicts with a confirmed booking" }] : []),
      ];
    case "setup": {
      // SCRUM-85/AC4: setup belongs to the booking that starts where it ends
      const booking = periods.find((p) => p.kind === "event" && p.start === period.end);
      return [{ term: "What it is", text: booking ? `Setup time for the booking that starts ${formatPeriodInstant(booking.start)}` : "Setup time for a booking that starts after this period" }];
    }
    case "turnaround": {
      const booking = periods.find((p) => p.kind === "event" && p.end === period.start);
      return [{ term: "What it is", text: booking ? `Turnaround time for the booking that ends ${formatPeriodInstant(booking.end)}` : "Turnaround time for a booking that ends before this period" }];
    }
    case "event":
      return period.occupied_start && period.occupied_end
        ? [{ term: "Occupied", text: `Occupied ${formatPeriodInstant(period.occupied_start)} to ${formatPeriodInstant(period.occupied_end)} including setup and turnaround` }]
        : [];
    case "closed":
      return [{ term: "Why", text: "Outside operating hours" }];
  }
}

// SCRUM-85/AC1 to AC4: what one period of a venue is, and exactly when it starts and ends.
export function VenueCalendarDetails({ venue, period, onClose }: { venue: CalendarVenue; period: CalendarPeriod; onClose: () => void }) {
  return (
    <section aria-label="Availability details" className="flex flex-col gap-3 rounded-lg border border-border-strong bg-muted/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-bold text-foreground">{venue.name}</h3>
          <p className="text-sm text-muted-foreground">{venue.address} · Capacity {venue.max_capacity}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X aria-hidden="true" />
          Close details
        </Button>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-medium text-foreground">Status</dt>
        <dd>{period.label}</dd>
        <dt className="font-medium text-foreground">Starts</dt>
        <dd>{formatPeriodInstant(period.start)}</dd>
        <dt className="font-medium text-foreground">Ends</dt>
        <dd>{formatPeriodInstant(period.end)}</dd>
        {kindLines(period, venue.periods).map(({ term, text }) => (
          <div key={term} className="contents">
            <dt className="font-medium text-foreground">{term}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
