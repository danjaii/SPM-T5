import Link from "next/link";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { describeFlag } from "@spm-t5/shared";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { canReplaceVenue, isAffected, replacementHref } from "@/lib/affectedBookings";
import { eventsThisWeek, needsActionCount } from "@/lib/coordinatorDashboard";
import { FLAG_DISPLAY } from "@/lib/status";
import type { CoordinatorDashboardData } from "@/lib/coordinatorDashboardServer";
import { CoordinatorThisWeek } from "./CoordinatorThisWeek";


// How many items "Needs your action" shows before pointing at the full lists.
const SHOWN = 5;

const Unavailable = () => (
  <p className="flex items-center gap-2 text-base font-medium text-status-warning-fg">
    <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
    Unavailable
  </p>
);

/** One task: what to do (bold, starts with a verb), which event it is for, and why. The whole row is the link. */
function TaskRow({ href, label, title, subtitle, note, cta, primary, children }: { href: string; label: string; title: string; subtitle: string; note?: string; cta: string; primary?: boolean; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} aria-label={label} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-status-warning text-status-warning-fg" aria-hidden="true">
          <TriangleAlert className="size-5" />
        </span>
        <span className="min-w-0 flex-1 basis-64 space-y-0.5">
          <span className="block text-base font-semibold">{title}</span>
          <span className="block text-sm text-muted-foreground">{subtitle}</span>
          {note && <span className="block text-sm text-status-warning-fg">{note}</span>}
        </span>
        <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-3">
          {children}
          {/* Looks like a button; the whole row is the one link, so this is not a second control. */}
          <span aria-hidden="true" className={cn(buttonVariants({ variant: primary ? "default" : "outline", size: "sm" }), "pointer-events-none")}>{cta}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * SCRUM-160: the Event Coordinator's overview, in the order a coordinator needs it: what to do first, then where things
 * stand. It does not list events or bookings: those stay on Event requests and My venue bookings. A source that failed
 * (undefined) is shown as unavailable, never as 0 or "nothing to do".
 */
export function CoordinatorDashboardOverview({ events, bookings, returned, now = new Date() }: CoordinatorDashboardData & { now?: Date }) {
  const flagged = bookings?.filter(isAffected);
  const actionCount = needsActionCount(bookings, returned);

  return (
    <>
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
        <section aria-labelledby="needs-action" className="overflow-hidden rounded-xl border border-border bg-card lg:col-span-2">
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
            <h2 id="needs-action" className="font-heading text-xl font-bold">Needs your action</h2>
            {actionCount !== undefined && actionCount > 0 && <StatusBadge tone="danger" label={`${actionCount} to do`} />}
          </div>

          {actionCount === undefined && <div className="p-5"><Unavailable /></div>}

          {actionCount === 0 && (
            <p className="flex items-center gap-3 p-5 text-base font-medium">
              <CircleCheck className="size-6 shrink-0 text-status-success-fg" aria-hidden="true" />
              Nothing needs your action right now. You are all caught up.
            </p>
          )}

          {!!actionCount && (
            <ul className="divide-y divide-border">
              {flagged?.slice(0, SHOWN).map((b) => {
                const replace = canReplaceVenue(b);
                return (
                  <TaskRow
                    key={b.id}
                    href={replace ? replacementHref(b.id) : `/venue-bookings/${b.id}`}
                    label={`${replace ? "Find replacement venue" : "View booking"} for ${b.eventName} at ${b.venueName}`}
                    title={replace ? "Find another venue" : "Check the venue booking"}
                    subtitle={`${b.eventName} · ${b.venueName}`}
                    note={b.flags.map((f) => describeFlag(f, b.venueName)).join(" ")}
                    cta={replace ? "Find venue" : "Open"}
                    primary={replace}
                  >
                    {b.flags.map((f) => <StatusBadge key={f.id} {...FLAG_DISPLAY[f.kind]} />)}
                  </TaskRow>
                );
              })}
              {returned?.slice(0, SHOWN).map((e) => (
                <TaskRow key={e.id} href={`/events/${e.id}`} label={`Open ${e.name}`} title="Update the event" subtitle={e.name} note={e.reason} cta="Open">
                  <StatusBadge tone="warning" label="Returned to Planning" />
                </TaskRow>
              ))}
            </ul>
          )}

          {actionCount !== undefined && actionCount > SHOWN && (
            <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
              Showing {SHOWN} of {actionCount}. See the rest in{" "}
              <Link className="underline" href="/venue-bookings">My venue bookings</Link> and{" "}
              <Link className="underline" href="/events/review">Event requests</Link>.
            </p>
          )}
        </section>

        <CoordinatorThisWeek items={events && eventsThisWeek(events, bookings, now)} />
      </div>
    </>
  );
}
