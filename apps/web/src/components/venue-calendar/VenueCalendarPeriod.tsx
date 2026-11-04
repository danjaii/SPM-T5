import { Ban, Check, CheckCircle2, Clock, Info, Moon, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import type { CalendarPeriod, CalendarPeriodKind, CalendarStatus } from "@/lib/venueCalendar";

// SCRUM-84/AC2 to AC4, SCRUM-130/AC6. Jerome: this file is the one place that decides how a period looks. Status is an icon plus
// its text label, never colour alone. Colours follow Figma 09: Confirmed green, held teal, unavailable grey, free white.
export const STATUS_LOOK: Record<CalendarStatus, { icon: LucideIcon; className: string; short: string }> = {
  TENTATIVELY_HELD: { icon: Clock, className: "bg-status-info text-status-info-fg", short: "Held" },
  CONFIRMED: { icon: CheckCircle2, className: "bg-status-success text-status-success-fg", short: "Booked" },
  BLOCKED: { icon: Ban, className: "bg-status-neutral text-status-neutral-fg", short: "Blocked" },
  AVAILABLE: { icon: Check, className: "bg-card text-foreground", short: "Free" },
  UNAVAILABLE: { icon: Moon, className: "bg-muted text-muted-foreground", short: "Closed" },
};

// Setup and turnaround are named and drawn dashed, so they read as part of the booking but not as the event itself.
export const KIND_NAME: Partial<Record<CalendarPeriodKind, string>> = { event: "Event", setup: "Setup", turnaround: "Turnaround" };

/** How a period is drawn on the calendar: its status colour, and the dashed or striped pattern that also tells it apart. */
export function periodLook(period: CalendarPeriod): string {
  // SCRUM-130/AC1: setup and turnaround are tinted and dashed, so they read as time around the event, not the event
  if (period.kind === "setup" || period.kind === "turnaround") return cn("border border-dashed border-border-strong", STATUS_LOOK[period.status].className);
  // free time is the plain background; time outside operating hours is a quiet grey
  if (period.kind === "open") return "text-foreground";
  if (period.kind === "closed") return STATUS_LOOK.UNAVAILABLE.className;
  // SCRUM-130/AC2: a block is striped, and drawn in the danger colour where it lies over a confirmed booking (Figma "Conflict")
  if (period.kind === "block")
    return cn(
      "calendar-block border",
      period.overlaps_confirmed_booking ? "border-status-danger-fg bg-status-danger text-status-danger-fg" : cn("border-border-strong", STATUS_LOOK.BLOCKED.className),
    );
  return cn("border border-border-strong", STATUS_LOOK[period.status].className);
}

/** A block's reason in words: "Blocked: Maintenance". */
export const blockReason = (period: CalendarPeriod) => (period.reason_label ? `${period.label}: ${period.reason_label}` : period.label);

/**
 * SCRUM-130/AC2: a block's reason on hover, on tap (click) and on keyboard focus, so it does not depend on a native title tooltip.
 * Escape closes it. The reason is also written out in the block.
 */
export function ReasonHint({ text }: { text: string }) {
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
        onFocus={() => { setFocused(true); }}
        onBlur={() => { setFocused(false); setTapped(false); }}
        onClick={() => setTapped((open) => !open)}
        onKeyDown={(e) => { if (e.key === "Escape") { setHovered(false); setFocused(false); setTapped(false); } }}
        className="inline-flex size-6 items-center justify-center rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Info aria-hidden="true" className="size-4" />
      </button>
      {shown && (
        <span id={id} role="tooltip" className="absolute top-full right-0 z-20 mt-1 w-max max-w-64 rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md">
          {text}
        </span>
      )}
    </span>
  );
}
