import Link from "next/link";
import { CircleCheck, Inbox, TimerOff, TriangleAlert, type LucideIcon } from "lucide-react";
import { describeFlag } from "@spm-t5/shared";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { FLAG_DISPLAY } from "@/lib/status";
import { timingNote, type QueueItemView } from "@/lib/bookingQueue";
import { currentBlocks, decisionRows, dayMonth, todaysBookings, venueStaffKpis, weekdayDate, type ScheduleItemView, type VenueBlockView } from "@/lib/venueStaffDashboard";
import { LeadKpiCards } from "./LeadKpiCards";

// How many requests "Needs your decision" shows before pointing at the whole queue.
const SHOWN = 5;

const Unavailable = () => (
  <p className="flex items-center gap-2 text-base font-medium text-status-warning-fg">
    <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
    Unavailable
  </p>
);

const ROW_ICON: Record<"danger" | "warning" | "none", { Icon: LucideIcon; tile: string }> = {
  danger: { Icon: TriangleAlert, tile: "bg-status-danger text-status-danger-fg" },
  warning: { Icon: TimerOff, tile: "bg-status-warning text-status-warning-fg" },
  none: { Icon: Inbox, tile: "bg-muted text-muted-foreground" },
};

/** One pending request: what it is, where and when, why it is flagged, and a Review button to decide it. */
function DecisionRow({ r }: { r: QueueItemView }) {
  const tone = r.flags.length === 0 ? "none" : r.flags.some((f) => f.kind === "buffer_conflict") ? "danger" : "warning";
  const { Icon, tile } = ROW_ICON[tone];
  return (
    <li className="flex items-center gap-4 p-4">
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tile)} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold">{r.eventName}</p>
        <p className="text-sm text-muted-foreground">
          {r.venueName} · {weekdayDate(r.date)}, {r.startTime}–{r.endTime}
        </p>
        {r.flags.map((f) => (
          <p key={f.id} className="text-xs text-status-warning-fg">{describeFlag(f, r.venueName)}</p>
        ))}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {r.flags.length === 0 ? (
          <StatusBadge tone="success" label="No conflicts" />
        ) : (
          r.flags.map((f) => <StatusBadge key={f.id} {...FLAG_DISPLAY[f.kind]} />)
        )}
        <Link href={`/booking-queue/${r.id}`} aria-label={`Review ${r.eventName} at ${r.venueName}`} className={cn(buttonVariants({ variant: r.flags.length > 0 ? "default" : "outline", size: "sm" }))}>
          Review
        </Link>
      </div>
    </li>
  );
}

/**
 * SCRUM-163: the Venue Staff home, as Figma 17 draws it. Figures first (Waiting links to the queue), then the requests to
 * decide with the flagged ones on top, then today's schedule and any venue that is blocked. The venue catalogue is one link
 * in the sidebar, not a table here. A source that failed (undefined) is shown as unavailable, never as 0.
 */
export function VenueStaffDashboardOverview({ requests, schedule, blocks, now = new Date() }: { requests?: QueueItemView[]; schedule?: ScheduleItemView[]; blocks?: VenueBlockView[]; now?: Date }) {
  const kpis = venueStaffKpis(requests, schedule, blocks, now);
  const rows = requests ? decisionRows(requests) : [];
  const today = schedule ? todaysBookings(schedule, now) : undefined;
  const upcomingBlocks = blocks ? currentBlocks(blocks, now) : undefined;

  return (
    <>
      {kpis.length > 0 && <LeadKpiCards kpis={kpis} />}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="needs-decision">
          <Card>
            <CardContent className="space-y-0 p-0">
              <div className="flex items-center justify-between border-b border-border p-4">
                <h2 id="needs-decision" className="font-heading text-xl font-bold">Needs your decision</h2>
                {requests && <span className="rounded-md bg-muted px-2 text-sm font-semibold tabular-nums">{requests.length}</span>}
              </div>
              {!requests ? (
                <div className="p-4"><Unavailable /></div>
              ) : requests.length === 0 ? (
                <p className="flex items-center gap-3 p-4 text-base font-medium">
                  <CircleCheck className="size-6 shrink-0 text-status-success-fg" aria-hidden="true" />
                  No booking requests are waiting. You are all caught up.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {rows.slice(0, SHOWN).map((r) => <DecisionRow key={r.id} r={r} />)}
                </ul>
              )}
              {requests && requests.length > SHOWN && (
                <p className="border-t border-border p-4 text-sm text-muted-foreground">
                  Showing {SHOWN} of {requests.length}. See the rest in <Link className="underline" href="/booking-queue">Booking requests</Link>.
                </p>
              )}
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="today">
          <Card>
            <CardContent className="space-y-4">
              <h2 id="today" className="font-heading text-xl font-bold">Today at your venues</h2>
              {!today || !upcomingBlocks ? (
                <Unavailable />
              ) : today.length === 0 && upcomingBlocks.length === 0 ? (
                <p className="text-base text-muted-foreground">Nothing is booked for today.</p>
              ) : (
                <ul className="space-y-4">
                  {today.map((b) => (
                    <li key={b.id} className="flex items-start gap-3">
                      <span className="rounded-md bg-muted px-2 py-1 text-sm font-semibold tabular-nums">{b.startTime}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{b.eventName}</span>
                        <span className="block text-xs text-muted-foreground">{b.venueName} · {b.startTime}–{b.endTime}</span>
                        {timingNote(b) && <span className="block text-xs text-muted-foreground">{timingNote(b)}</span>}
                      </span>
                      <StatusBadge tone="success" label="Confirmed" />
                    </li>
                  ))}
                  {upcomingBlocks.slice(0, 2).map((b) => (
                    <li key={`${b.venueName}-${b.start}`} className="flex items-start gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{b.venueName} unavailable</span>
                        <span className="block text-xs text-muted-foreground">{b.reasonLabel} {dayMonth(b.start)}–{dayMonth(b.end)}</span>
                        <span className="block text-xs text-muted-foreground">Not available for new bookings in this period</span>
                      </span>
                      <StatusBadge {...FLAG_DISPLAY.venue_unavailable} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}
