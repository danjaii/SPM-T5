"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReviewQueueItem } from "@/lib/eventsApi";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EventStatusBadge from "./EventStatusBadge";

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

export function ReviewQueueTable({ events }: { events: ReviewQueueItem[] }) {
  const router = useRouter();

  // SCRUM-151/AC3: a click anywhere on the row opens the event. A click on the event's name is left to its link, so the
  // page is not opened twice; a click with a modifier key is left to the browser.
  const open = (id: string) => (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as Element).closest("a") || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    router.push(`/events/${encodeURIComponent(id)}`);
  };

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
          // SCRUM-151/AC2: the whole row shows it can be clicked; the muted tint stands out on the white card, the shared
          // accent hover does not
          <TableRow key={event.id} className="cursor-pointer hover:bg-muted" onClick={open(event.id)}>
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
