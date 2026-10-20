import { Clock, Inbox } from "lucide-react";
import Link from "next/link";
import { QueueAssignCell } from "@/components/QueueAssignCell";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { shortDate, waitingDays, waitingLabel } from "@/lib/leadQueueView";
import type { LeadCoordinator, LeadQueueItem } from "@/lib/leadServer";

const NOT_SPECIFIED = "Not specified";
/** A request waiting this many days or more is drawn in the warning colour, with a clock, so it is noticed. */
const LONG_WAIT_DAYS = 3;

interface Props {
  requests: LeadQueueItem[];
  /** The Lead's eligible coordinators for the row dropdown; without any, a row links to its assign page instead. */
  coordinators?: LeadCoordinator[];
  now?: Date;
}

// SCRUM-77/AC1-AC3, AC6: the requests waiting for a coordinator, in the order event-service sends them (oldest first).
// SCRUM-126/AC1, AC2: laid out as Figma 04 (Event, Organiser, Date, Waiting, Assign to) with an inline assign dropdown.
export function LeadQueueList({ requests, coordinators, now }: Props) {
  if (requests.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-6 py-10 text-center">
        <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No event requests are awaiting coordinator assignment.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead>Organiser</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Waiting</TableHead>
            <TableHead>Assign to</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((r) => {
            const days = waitingDays(r.submitted_at, now);
            const long = days !== null && days >= LONG_WAIT_DAYS;
            return (
              <TableRow key={r.id}>
                <TableCell>
                  {/* SCRUM-126: open the event's details before assigning it */}
                  <Link className="block font-medium underline-offset-4 hover:underline" href={`/lead/events/${r.id}`}>{r.name}</Link>
                  <div className="text-xs text-muted-foreground">
                    {r.expected_attendance === null ? NOT_SPECIFIED : `${r.expected_attendance} people`}
                  </div>
                </TableCell>
                <TableCell>{r.organiser_name ?? "Unknown"}</TableCell>
                <TableCell>{r.preferred_start_datetime ? shortDate(r.preferred_start_datetime, now) : NOT_SPECIFIED}</TableCell>
                <TableCell className={long ? "font-semibold text-status-warning-fg" : undefined}>
                  <span className="inline-flex items-center gap-1">
                    {long && <Clock className="size-3.5" aria-hidden="true" />}
                    {waitingLabel(r.submitted_at, now)}
                  </span>
                </TableCell>
                <TableCell>
                  {coordinators && coordinators.length > 0 ? (
                    <QueueAssignCell eventId={r.id} eventName={r.name} coordinators={coordinators} />
                  ) : (
                    // SCRUM-78/AC1: the assign step explains when nobody can be chosen
                    <Link
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                      href={`/lead/events/${r.id}/assign`}
                      aria-label={`Assign ${r.name}`}
                    >
                      Assign to…
                    </Link>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
