import Link from "next/link";
import { ArrowRight, MessageSquare, ShieldCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import type { SafetyHome } from "@/lib/safetyCheckServer";
import { decisionView, eventSummary, rowStatus, weekdayDate } from "@/lib/safetyHome";

const QUEUE = "/safety-checks";

function Figure({ label, value, note, href }: { label: string; value: number; note: string; href?: string }) {
  return (
    <li>
      <Card className="h-full">
        <CardContent className="space-y-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
          <p className="font-heading text-3xl font-bold">{href ? <Link href={href} className="hover:underline">{value}</Link> : value}</p>
          <p className="text-xs text-muted-foreground">{note}</p>
        </CardContent>
      </Card>
    </li>
  );
}

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-status-info text-status-info-fg">
      <Icon className="size-5" aria-hidden="true" />
    </span>
  );
}

/**
 * SCRUM-165 (Figma 19): the Safety Officer Home under the greeting: four figures, the events waiting for a check (AC1: the
 * count links to the queue; AC2: one back after changes is tagged "Re-check needed"; AC3: an empty state) and the latest
 * decisions. Every row is the same flex row with a fixed-width tag column and action column, so the tags and buttons
 * line up down the list whatever the event name or tag label.
 */
export function SafetyOfficerHome({ home }: { home: SafetyHome }) {
  const { ready } = home;
  const rechecks = ready.filter((e) => e.recheck).length;

  return (
    <>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Summary">
        <Figure
          label="Ready for check"
          value={ready.length}
          href={QUEUE}
          note={ready[0]?.start ? `Next event ${weekdayDate(ready[0].start)}` : "Nothing is waiting"}
        />
        <Figure label="Re-check needed" value={rechecks} note={rechecks > 0 ? "Changed after a decision" : "Nothing came back"} />
        <Figure label="Waiting on coordinator" value={home.waiting_on_coordinator} note="Changes requested" />
        <Figure
          label="Approved this month"
          value={home.approved_this_month}
          note={home.revoked_this_month > 0 ? `${home.revoked_this_month} revoked` : "No revoked approvals"}
        />
      </ul>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3 border-b">
            <CardTitle>
              <Link href={QUEUE} className="hover:underline">Safety checks</Link>
            </CardTitle>
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-2 text-xs font-semibold" aria-label={`${ready.length} waiting`}>
              {ready.length}
            </span>
          </CardHeader>
          <CardContent className="px-0">
            {ready.length === 0 ? (
              <p role="status" className="flex items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
                <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
                No events are waiting for a safety check.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {ready.map((e, i) => {
                  const status = rowStatus(e);
                  return (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:flex-nowrap">
                      <RowIcon icon={e.recheck ? TriangleAlert : ShieldCheck} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{e.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{eventSummary(e)}</p>
                      </div>
                      <div className="flex shrink-0 sm:w-40 sm:justify-end">
                        <StatusBadge tone={status.tone} icon={status.icon} label={status.label} />
                      </div>
                      <Link
                        href={`${QUEUE}/${encodeURIComponent(e.id)}`}
                        aria-label={`${status.action}: ${e.name}`}
                        className={cn(buttonVariants({ variant: i === 0 ? "default" : "outline", size: "sm" }), "shrink-0 sm:w-32")}
                      >
                        {status.action}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recently decided</CardTitle>
          </CardHeader>
          <CardContent>
            {home.recent.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <MessageSquare className="size-4 shrink-0" aria-hidden="true" />
                No decisions yet.
              </p>
            ) : (
              <ul className="space-y-4">
                {home.recent.map((d) => {
                  const { display, note } = decisionView(d);
                  return (
                    <li key={`${d.event_id}-${d.decided_at}`} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{d.name}</p>
                        <p className="text-xs text-muted-foreground">{note}</p>
                      </div>
                      <div className="flex shrink-0 sm:w-40 sm:justify-end lg:w-36">
                        <StatusBadge {...display} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** The header action: opens the soonest waiting event's check (AC1's route into the queue stays on the count). */
export function StartNextCheck({ home }: { home: SafetyHome }) {
  const next = home.ready[0];
  if (!next) return null;
  return (
    <Link href={`${QUEUE}/${encodeURIComponent(next.id)}`} className={buttonVariants({ variant: "default" })}>
      Start next check
      <ArrowRight aria-hidden="true" />
    </Link>
  );
}
