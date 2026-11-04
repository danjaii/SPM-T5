"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import EventStatusBadge from "@/components/EventStatusBadge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatLastSaved } from "@/lib/formatLastSaved";
import {
  changeOutcomeText,
  eventSubline,
  eventsInTab,
  formatDay,
  formatShortDay,
  formatTimeRange,
  homeCounts,
  isDraft,
  needingReply,
  nextConfirmed,
  type OrganiserHomeEvent,
  type OrganiserTab,
} from "@/lib/organiserHome";
import { LINKED_ROW_CLASS, openRowLink, ROW_LINK_FOCUS_CLASS } from "@/lib/rowLink";
import { cn } from "@/lib/utils";

const TABS: { value: OrganiserTab; label: string; count: (c: ReturnType<typeof homeCounts>) => number }[] = [
  { value: "all", label: "All", count: (c) => c.all },
  { value: "drafts", label: "Drafts", count: (c) => c.drafts },
  { value: "in_progress", label: "In progress", count: (c) => c.inProgress },
  { value: "confirmed", label: "Confirmed", count: (c) => c.confirmed },
];

// A draft reopens the form with it loaded (SCRUM-54/AC1); anything else opens the event page, where comments are answered
const hrefOf = (e: OrganiserHomeEvent) => (isDraft(e) ? `/events/new?draft=${encodeURIComponent(e.id)}` : `/events/${encodeURIComponent(e.id)}`);
const actionOf = (e: OrganiserHomeEvent) => (isDraft(e) ? "Continue editing" : e.clarification ? "Reply" : "View");
const firstName = (name: string) => name.split(" ")[0];

/**
 * SCRUM-159 (Figma 02): the Event Organiser Home. AC1: a figure and a tab count for each group of statuses, and each row's
 * status badge keeps its icon and label. AC2: an event the coordinator asked about is in the banner, the "Needs your reply"
 * card and its row, and links to the event. AC3: a decided change request's outcome shows on its row. AC4: no events at all
 * shows an empty state that links to a new request. `now` comes from the server so the "Next:" line renders the same twice.
 */
export function OrganiserHome({ events, now }: { events: OrganiserHomeEvent[]; now: string }) {
  const [tab, setTab] = useState<OrganiserTab>("all");

  if (events.length === 0) {
    return (
      <div data-state="empty" className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong px-6 py-10 text-center">
        <Inbox aria-hidden="true" className="size-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">You have not created any event requests yet.</p>
        <Link href="/events/new" className={buttonVariants()}>
          Create an event request
        </Link>
      </div>
    );
  }

  const counts = homeCounts(events);
  const waiting = needingReply(events);
  const next = nextConfirmed(events, new Date(now));

  return (
    <div className="space-y-6">
      {waiting.length > 0 && (
        <Alert data-testid="needs-reply-banner" className="sm:flex-row sm:items-center sm:justify-between">
          <div>
            <AlertTitle>Your coordinator needs more information on {waiting[0].name}</AlertTitle>
            <AlertDescription>
              {waiting[0].clarification!.author_name} asked: &ldquo;{waiting[0].clarification!.text}&rdquo;
              {waiting.length > 1 && ` (${waiting.length - 1} more ${waiting.length === 2 ? "event needs" : "events need"} a reply)`}
            </AlertDescription>
          </div>
          <Link href={hrefOf(waiting[0])} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
            Reply to {firstName(waiting[0].clarification!.author_name)}
          </Link>
        </Alert>
      )}

      <section aria-label="Your events at a glance" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="Drafts" value={counts.drafts} note="Not yet submitted" />
        <Figure label="In review" value={counts.inReview} note="Waiting on ConnectSphere" />
        <Figure
          label="Needs your reply"
          value={counts.needsReply}
          note={waiting[0] ? `Reply to ${firstName(waiting[0].clarification!.author_name)}` : "Nothing waiting"}
          href={waiting[0] ? hrefOf(waiting[0]) : undefined}
        />
        <Figure label="Confirmed" value={counts.confirmed} note={next ? `Next: ${next.name}, ${formatShortDay(next.start!)}` : "No upcoming event"} />
      </section>

      <Tabs value={tab} onValueChange={(v) => setTab(v as OrganiserTab)}>
        <TabsList variant="line" aria-label="Filter your events">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              <span className="rounded-full bg-status-info px-1.5 text-xs text-status-info-fg">{t.count(counts)}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            <EventTable events={eventsInTab(events, t.value)} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function Figure({ label, value, note, href }: { label: string; value: number; note: string; href?: string }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-xs font-bold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="font-heading text-3xl font-bold">{value}</p>
      {href ? (
        <Link href={href} className="text-sm font-bold text-status-warning-fg underline-offset-4 hover:underline">
          {note} →
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">{note}</p>
      )}
    </Card>
  );
}

function EventTable({ events }: { events: OrganiserHomeEvent[] }) {
  const router = useRouter();
  if (events.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No events here.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Attendance</TableHead>
          <TableHead>Coordinator</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>
            <span className="sr-only">Action</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => {
          const href = hrefOf(e);
          return (
            <TableRow key={e.id} className={LINKED_ROW_CLASS} onClick={(ev) => openRowLink(ev, router.push, href)}>
              <TableCell>
                <Link href={href} className={cn("font-bold text-foreground underline-offset-4 hover:underline", ROW_LINK_FOCUS_CLASS)}>
                  {e.name}
                </Link>
                <p className="text-xs text-muted-foreground">{eventSubline(e, isDraft(e) && e.updated_at ? formatLastSaved(e.updated_at) : null)}</p>
              </TableCell>
              <TableCell>
                {e.start ? (
                  <>
                    <span className="font-bold">{formatDay(e.start)}</span>
                    <p className="text-xs text-muted-foreground">{formatTimeRange(e.start, e.end)}</p>
                  </>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )}
              </TableCell>
              <TableCell>{e.expected_attendance ?? "—"}</TableCell>
              <TableCell>
                {e.coordinator_name ? (
                  <>
                    <span className="font-bold">{e.coordinator_name}</span>
                    {e.coordinator_assigned_at && <p className="text-xs text-muted-foreground">Assigned {formatShortDay(e.coordinator_assigned_at)}</p>}
                  </>
                ) : (
                  <span className="text-muted-foreground">{isDraft(e) ? "—" : "Not assigned yet"}</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-col items-start gap-1">
                  {e.clarification ? <StatusBadge tone="warning" label="Needs your reply" /> : <EventStatusBadge status={e.status} />}
                  {e.change_outcome && <span className="text-xs text-muted-foreground">{changeOutcomeText(e.change_outcome)}</span>}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <Link href={href} tabIndex={-1} aria-label={`${actionOf(e)}: ${e.name}`} className="text-sm font-bold text-primary underline-offset-4 hover:underline">
                  {actionOf(e)} ›
                </Link>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
