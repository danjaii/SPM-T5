import Link from "next/link";
import { ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge, StatusIcon } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { canReplaceVenue, isAffected, replacementHref } from "@/lib/affectedBookings";
import { bookingPeek, eventPeek, groupBookingsByStatus, groupEventsByStatus } from "@/lib/coordinatorDashboard";
import type { StatusDisplay, StatusTone } from "@/lib/status";
import type { CoordinatorDashboardData } from "@/lib/coordinatorDashboardServer";
import { BOOKING_STATUS_DISPLAY, EVENT_STATUS_DISPLAY } from "@/lib/status";
import { FlagBadges } from "./FlagBadges";

// How many items "Needs your action" shows before pointing at the full tabs.
const SHOWN = 5;

const Unavailable = () => (
  <p className="flex items-center gap-2 text-base font-medium text-status-warning-fg">
    <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
    Unavailable
  </p>
);

/** One task: what to do (bold, starts with a verb), which event it is for, and why. The whole row is the link. */
function TaskRow({ href, label, title, subtitle, children }: { href: string; label: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} aria-label={label} className="flex items-start gap-4 p-4 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-status-warning text-status-warning-fg" aria-hidden="true">
          <TriangleAlert className="size-5" />
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block text-base font-semibold">{title}</span>
          <span className="block text-sm text-muted-foreground">{subtitle}</span>
          <span className="block pt-1">{children}</span>
        </span>
        <ChevronRight className="mt-2 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

// A tab takes its status's colour: softly tinted while closed, solid with a ring while open. The label and icon still say the status.
const TAB_TONE: Record<StatusTone, string> = {
  neutral: "bg-status-neutral/40 text-status-neutral-fg data-active:bg-status-neutral data-active:ring-status-neutral-fg/40",
  info: "bg-status-info/40 text-status-info-fg data-active:bg-status-info data-active:ring-status-info-fg/40",
  warning: "bg-status-warning/40 text-status-warning-fg data-active:bg-status-warning data-active:ring-status-warning-fg/40",
  success: "bg-status-success/40 text-status-success-fg data-active:bg-status-success data-active:ring-status-success-fg/40",
  danger: "bg-status-danger/40 text-status-danger-fg data-active:bg-status-danger data-active:ring-status-danger-fg/40",
};

interface PeekRow {
  id: string;
  href: string;
  title: string;
  peek: string[];
}

/**
 * A section whose title sits above a white card. The card holds one tab per status (icon, label and count) and, under the
 * open tab, a short peek of each item: its name and a line of details. Each row opens the item. Only the first few show; the
 * link at the foot goes to the full list.
 */
function StatusCard({ id, title, viewAll, empty, groups }: { id: string; title: string; viewAll: { href: string; text: string }; empty: string; groups?: { key: string; display: StatusDisplay; rows: PeekRow[] }[] }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="font-heading text-xl font-bold">{title}</h2>
      <Card>
        <CardContent className="space-y-4">
          {!groups ? (
            <Unavailable />
          ) : groups.length === 0 ? (
            <p className="text-base text-muted-foreground">{empty}</p>
          ) : (
            <Tabs defaultValue={groups[0].key} className="gap-0">
              <TabsList variant="line" className="w-full flex-wrap justify-start gap-2 pb-1 group-data-horizontal/tabs:h-auto">
                {groups.map((g) => (
                  <TabsTrigger
                    key={g.key}
                    value={g.key}
                    className={cn("h-auto flex-none gap-1.5 rounded-lg border-0 px-3 py-1.5 text-sm font-medium transition-colors duration-150 after:hidden hover:brightness-95 data-active:font-semibold data-active:ring-1", TAB_TONE[g.display.tone])}
                  >
                    <StatusIcon {...g.display} />
                    {g.display.label}
                    <span className="rounded-md bg-background/70 px-1.5 text-xs font-semibold tabular-nums">{g.rows.length}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
              {groups.map((g) => (
                <TabsContent key={g.key} value={g.key}>
                  <ul className="space-y-1 pt-2">
                    {g.rows.slice(0, SHOWN).map((r) => (
                      <li key={r.id}>
                        <Link href={r.href} className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-3 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="min-w-0 flex-1">
                            <span className="block text-base font-medium">{r.title}</span>
                            <span className="block text-sm text-muted-foreground">{r.peek.join(" · ")}</span>
                          </span>
                          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {g.rows.length > SHOWN && <p className="pt-2 text-sm text-muted-foreground">Showing {SHOWN} of {g.rows.length}.</p>}
                </TabsContent>
              ))}
            </Tabs>
          )}
          <Link href={viewAll.href} className="inline-flex items-center gap-1 rounded-lg border border-transparent px-3 text-base font-medium text-fg-primary underline-offset-4 hover:underline">
            {viewAll.text}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * SCRUM-160: the Event Coordinator's overview, in the order a coordinator needs it: what to do first, then where things
 * stand. It does not list events or bookings: those stay on Event requests and My venue bookings. A source that failed
 * (undefined) is shown as unavailable, never as 0 or "nothing to do".
 */
export function CoordinatorDashboardOverview({ events, bookings, returned }: CoordinatorDashboardData) {
  const flagged = bookings?.filter(isAffected);
  const actionCount = flagged || returned ? (flagged?.length ?? 0) + (returned?.length ?? 0) : undefined;

  return (
    <>
      <section aria-labelledby="needs-action" className="space-y-4">
        <div className="space-y-1">
          <h2 id="needs-action" className="font-heading text-2xl font-bold">Needs your action</h2>
          {actionCount !== undefined && actionCount > 0 && (
            <p className="text-base text-muted-foreground">
              {actionCount} {actionCount === 1 ? "thing needs" : "things need"} your attention.
            </p>
          )}
        </div>

        {actionCount === undefined && <Unavailable />}

        {actionCount === 0 && (
          <p className="flex items-center gap-3 rounded-xl bg-muted p-4 text-base font-medium">
            <CircleCheck className="size-6 shrink-0 text-status-success-fg" aria-hidden="true" />
            Nothing needs your action right now. You are all caught up.
          </p>
        )}

        {!!actionCount && (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {flagged?.slice(0, SHOWN).map((b) => {
              const replace = canReplaceVenue(b);
              return (
                <TaskRow
                  key={b.id}
                  href={replace ? replacementHref(b.id) : `/venue-bookings/${b.id}`}
                  label={`${replace ? "Find replacement venue" : "View booking"} for ${b.eventName} at ${b.venueName}`}
                  title={replace ? "Find another venue" : "Check the venue booking"}
                  subtitle={`${b.eventName} · ${b.venueName}`}
                >
                  <FlagBadges flags={b.flags} venueName={b.venueName} label="" />
                </TaskRow>
              );
            })}
            {returned?.slice(0, SHOWN).map((e) => (
              <TaskRow key={e.id} href={`/events/${e.id}`} label={`Open ${e.name}`} title="Update the event" subtitle={e.name}>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="warning" label="Returned to Planning" />
                  <span className="text-sm text-status-warning-fg">{e.reason}</span>
                </span>
              </TaskRow>
            ))}
          </ul>
        )}

        {actionCount !== undefined && actionCount > SHOWN && (
          <p className="text-sm text-muted-foreground">
            Showing {SHOWN} of {actionCount}. See the rest in{" "}
            <Link className="underline" href="/venue-bookings">My venue bookings</Link> and{" "}
            <Link className="underline" href="/events/review">Event requests</Link>.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <StatusCard
          id="my-events"
          title="My events"
          viewAll={{ href: "/events/review", text: "View event requests" }}
          empty="No events are assigned to you yet."
          groups={events && groupEventsByStatus(events).map(({ status, items }) => ({
            key: status,
            display: EVENT_STATUS_DISPLAY[status],
            rows: items.map((e) => ({ id: e.id, href: `/events/${e.id}`, title: e.name, peek: eventPeek(e) })),
          }))}
        />
        <StatusCard
          id="venue-requests"
          title="Venue requests"
          viewAll={{ href: "/venue-bookings", text: "View my venue bookings" }}
          empty="You have not requested any venue bookings yet."
          groups={bookings && groupBookingsByStatus(bookings).map(({ status, items }) => ({
            key: status,
            display: BOOKING_STATUS_DISPLAY[status],
            rows: items.map((b) => ({ id: b.id, href: `/venue-bookings/${b.id}`, title: b.eventName, peek: bookingPeek(b) })),
          }))}
        />
      </div>
    </>
  );
}
