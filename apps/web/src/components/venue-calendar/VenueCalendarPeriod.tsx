import { AlertTriangle, Ban, Check, CheckCircle2, Clock, Info, Moon, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPeriodTimes, type CalendarPeriod, type CalendarPeriodKind, type CalendarStatus } from "@/lib/venueCalendar";

// SCRUM-84/AC2 to AC4. Jerome: this file is the one place that decides how a period looks. Status is an icon plus its text label, never colour alone.
const STATUS_LOOK: Record<CalendarStatus, { icon: LucideIcon; className: string }> = {
  TENTATIVELY_HELD: { icon: Clock, className: "bg-status-warning text-status-warning-fg" },
  CONFIRMED: { icon: CheckCircle2, className: "bg-status-info text-status-info-fg" },
  BLOCKED: { icon: Ban, className: "bg-status-danger text-status-danger-fg" },
  AVAILABLE: { icon: Check, className: "bg-status-success text-status-success-fg" },
  UNAVAILABLE: { icon: Moon, className: "bg-status-neutral text-status-neutral-fg" },
};

// Setup and turnaround are named and drawn dashed, so they read as part of the booking but not as the event itself.
const KIND_NAME: Partial<Record<CalendarPeriodKind, string>> = { event: "Event", setup: "Setup", turnaround: "Turnaround" };

/**
 * SCRUM-130/AC2: a block's reason on hover, on tap (click) and on keyboard focus, so it does not depend on a native title tooltip.
 * Escape closes it. The reason is also written out in the row.
 */
function ReasonHint({ text }: { text: string }) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tapped, setTapped] = useState(false);
  const shown = hovered || focused || tapped;
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="Why is this blocked?"
        aria-describedby={shown ? id : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); setTapped(false); }}
        onClick={() => setTapped((open) => !open)}
        onKeyDown={(e) => { if (e.key === "Escape") { setHovered(false); setFocused(false); setTapped(false); } }}
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Info aria-hidden="true" className="size-4" />
      </button>
      {shown && (
        <span id={id} role="tooltip" className="absolute top-full left-0 z-10 mt-1 w-max max-w-64 rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
          {text}
        </span>
      )}
    </span>
  );
}

export function VenueCalendarPeriod({ period, selected = false, onSelect }: { period: CalendarPeriod; selected?: boolean; onSelect?: () => void }) {
  const { icon: Icon, className } = STATUS_LOOK[period.status];
  const padding = period.kind === "setup" || period.kind === "turnaround";
  return (
    <li
      data-kind={period.kind}
      // SCRUM-130/AC2: a block is striped and carries its reason as a hover title (the reason is also written out in the row)
      title={period.kind === "block" ? (period.reason_label ? `${period.label}: ${period.reason_label}` : period.label) : undefined}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm",
        // SCRUM-130/AC1: setup and turnaround are tinted and dashed, so they read as time around the event, not the event
        padding ? "ml-4 border-dashed border-border-strong bg-muted/40" : "border-border",
        period.kind === "block" && "calendar-block",
      )}
    >
      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold", className)}>
        <Icon aria-hidden="true" className="size-4" />
        {period.label}
      </span>
      {KIND_NAME[period.kind] && <span className="font-medium text-foreground">{KIND_NAME[period.kind]}</span>}
      {period.reason_label && <span className="font-medium text-foreground">{period.reason_label}</span>}
      {period.kind === "block" && <ReasonHint text={period.reason_label ? `${period.label}: ${period.reason_label}` : period.label} />}
      <span className="text-muted-foreground">{formatPeriodTimes(period.start, period.end)}</span>
      {/* SCRUM-130/AC1: the whole time the booking holds the venue, setup and turnaround included */}
      {period.kind === "event" && period.occupied_start && period.occupied_end && (
        <span className="font-medium text-foreground">
          Occupied {formatPeriodTimes(period.occupied_start, period.occupied_end)}
          {period.setup_minutes !== undefined && period.turnaround_minutes !== undefined ? ` (setup ${period.setup_minutes} min, turnaround ${period.turnaround_minutes} min)` : ""}
        </span>
      )}
      {onSelect && (
        <Button type="button" variant="ghost" size="sm" className="ml-auto" aria-pressed={selected}
          aria-label={`Details: ${period.label}, ${formatPeriodTimes(period.start, period.end)}`} onClick={onSelect}>
          Details
        </Button>
      )}
      {period.overlaps_confirmed_booking && (
        <span className="inline-flex items-center gap-1.5 font-semibold text-status-danger-fg">
          <AlertTriangle aria-hidden="true" className="size-4" />
          Conflicts with a confirmed booking
        </span>
      )}
    </li>
  );
}
