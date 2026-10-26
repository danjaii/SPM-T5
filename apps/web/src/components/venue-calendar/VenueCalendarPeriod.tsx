import { AlertTriangle, Ban, Check, CheckCircle2, Clock, Moon, type LucideIcon } from "lucide-react";
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

export function VenueCalendarPeriod({ period }: { period: CalendarPeriod }) {
  const { icon: Icon, className } = STATUS_LOOK[period.status];
  const padding = period.kind === "setup" || period.kind === "turnaround";
  return (
    <li
      data-kind={period.kind}
      className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-sm", padding ? "ml-4 border-dashed border-border-strong" : "border-border")}
    >
      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold", className)}>
        <Icon aria-hidden="true" className="size-4" />
        {period.label}
      </span>
      {KIND_NAME[period.kind] && <span className="font-medium text-foreground">{KIND_NAME[period.kind]}</span>}
      {period.reason_label && <span className="font-medium text-foreground">{period.reason_label}</span>}
      <span className="text-muted-foreground">{formatPeriodTimes(period.start, period.end)}</span>
      {period.overlaps_confirmed_booking && (
        <span className="inline-flex items-center gap-1.5 font-semibold text-status-danger-fg">
          <AlertTriangle aria-hidden="true" className="size-4" />
          Conflicts with a confirmed booking
        </span>
      )}
    </li>
  );
}
