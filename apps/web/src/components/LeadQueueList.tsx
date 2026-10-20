import { Inbox } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatSgt } from "@/lib/bookingQueue";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { LeadQueueItem } from "@/lib/leadServer";

const NOT_SPECIFIED = "Not specified";
const DAY_MS = 24 * 60 * 60 * 1000;

/** SCRUM-126/AC1: whole days a request has waited, "Today" for less than a day. */
export function waitingLabel(submittedAt: string | null, now = new Date()): string {
  if (!submittedAt) return NOT_SPECIFIED;
  const days = Math.max(0, Math.floor((now.getTime() - new Date(submittedAt).getTime()) / DAY_MS));
  if (days === 0) return "Today";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

// SCRUM-77/AC1-AC3, AC6: the requests waiting for a coordinator, in the order event-service sends them (oldest first).
// SCRUM-126/AC1: shown with how long each has waited, and an Assign button that opens its assign step.
export function LeadQueueList({ requests, now }: { requests: LeadQueueItem[]; now?: Date }) {
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
            <TableHead>Event Organiser</TableHead>
            <TableHead>Preferred date and time</TableHead>
            <TableHead>Expected attendance</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead>Waiting</TableHead>
            <TableHead>Assign to</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">{r.name}</TableCell>
              <TableCell>{r.organiser_name ?? "Unknown"}</TableCell>
              <TableCell>{r.preferred_start_datetime ? formatEventDateTime(r.preferred_start_datetime, r.preferred_end_datetime) : NOT_SPECIFIED}</TableCell>
              <TableCell>{r.expected_attendance ?? NOT_SPECIFIED}</TableCell>
              <TableCell>{r.submitted_at ? formatSgt(r.submitted_at) : NOT_SPECIFIED}</TableCell>
              <TableCell>{waitingLabel(r.submitted_at, now)}</TableCell>
              {/* SCRUM-78/AC1: choosing a request opens its assign step */}
              <TableCell>
                <Link
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  href={`/lead/events/${r.id}/assign`}
                  aria-label={`Assign ${r.name}`}
                >
                  Assign to…
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
