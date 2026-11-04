import { AlertTriangle } from "lucide-react";
import type { CalendarStatus } from "@/lib/venueCalendar";
import { cn } from "@/lib/utils";
import { STATUS_LOOK } from "./VenueCalendarPeriod";

const STATUSES: { status: CalendarStatus; label: string; pattern?: string }[] = [
  { status: "CONFIRMED", label: "Confirmed" },
  { status: "TENTATIVELY_HELD", label: "Tentatively Held" },
  { status: "BLOCKED", label: "Blocked", pattern: "calendar-block" },
  { status: "UNAVAILABLE", label: "Unavailable" },
];

/** SCRUM-130/AC6 (Figma 09): what each block on the calendar means, at the right of the view controls. Every entry is its icon and its words, as in the blocks. */
export function VenueCalendarLegend() {
  return (
    <ul aria-label="Legend" className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-xs text-muted-foreground">
      {STATUSES.map(({ status, label, pattern }) => {
        const { icon: Icon, className } = STATUS_LOOK[status];
        return (
          <li key={status} className="flex items-center gap-1.5">
            <span className={cn("inline-flex size-5 items-center justify-center rounded border border-border-strong", className, pattern)}>
              <Icon aria-hidden="true" className="size-3" />
            </span>
            {label}
          </li>
        );
      })}
      <li className="flex items-center gap-1.5">
        <span data-swatch aria-hidden="true" className="inline-block size-5 rounded border border-dashed border-border-strong bg-status-success" />
        Setup / turnaround
      </li>
      <li className="flex items-center gap-1.5">
        <span className="calendar-block inline-flex size-5 items-center justify-center rounded border border-status-danger-fg bg-status-danger text-status-danger-fg">
          <AlertTriangle aria-hidden="true" className="size-3" />
        </span>
        Conflict
      </li>
    </ul>
  );
}
