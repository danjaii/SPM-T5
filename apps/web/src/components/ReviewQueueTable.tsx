import Link from "next/link";
import type { ReviewQueueItem } from "@/lib/eventsApi";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EventStatusBadge from "./EventStatusBadge";

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

export function ReviewQueueTable({ events }: { events: ReviewQueueItem[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Organiser</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Submitted</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.id}>
            <TableCell className="font-semibold text-foreground">
              {/* SCRUM-23/AC1: open the full request from the list */}
              <Link href={`/events/${encodeURIComponent(event.id)}`} className="underline-offset-4 hover:underline">
                {event.name}
              </Link>
            </TableCell>
            <TableCell>{event.organiser_name ?? "—"}</TableCell>
            <TableCell>
              <EventStatusBadge status={event.status} />
            </TableCell>
            <TableCell>{formatDate(event.submitted_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ReviewQueueSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading event requests">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
