import type { CalendarStatus } from "@/lib/venueCalendar";
import { cn } from "@/lib/utils";
import { STATUS_LOOK } from "./VenueCalendarPeriod";

const STATUSES: { status: CalendarStatus; label: string }[] = [
  { status: "CONFIRMED", label: "Confirmed" },
  { status: "TENTATIVELY_HELD", label: "Tentatively Held" },
  { status: "BLOCKED", label: "Blocked" },
  { status: "AVAILABLE", label: "Available" },
  { status: "UNAVAILABLE", label: "Unavailable" },
];

/** SCRUM-130/AC5 (Figma 09): what each block on the week grid means. Every status is its icon and its words, as in the blocks. */
export function VenueCalendarLegend() {
  return (
    <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
      {STATUSES.map(({ status, label }) => {
        const { icon: Icon, className } = STATUS_LOOK[status];
        return (
          <li key={status} className="flex items-center gap-1.5">
            <span className={cn("inline-flex size-5 items-center justify-center rounded-md", className)}>
              <Icon aria-hidden="true" className="size-3" />
            </span>
            {label}
          </li>
        );
      })}
      <li className="flex items-center gap-1.5">
        <span data-swatch aria-hidden="true" className="inline-block size-5 rounded-md border border-dashed border-border-strong bg-muted/60" />
        Setup and turnaround
      </li>
    </ul>
  );
}
