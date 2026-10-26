"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import { LINKED_ROW_CLASS, openRowLink, ROW_LINK_FOCUS_CLASS } from "@/lib/rowLink";
import type { SafetyQueueItem } from "@/lib/safetyCheckServer";

const NOT_SPECIFIED = "Not specified";

// SCRUM-99/AC2: the events ready for an Operational Safety Check, in the order event-service sends them (soonest first).
// SCRUM-142/AC1: each row carries its status as an icon and label, and opens the check from anywhere on it; the
// attendance and venue columns give way on a phone, so the page never scrolls sideways.
export function SafetyCheckQueue({ events }: { events: SafetyQueueItem[] }) {
  const router = useRouter();

  if (events.length === 0) {
    return (
      <p role="status" className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        No events are waiting for a safety check.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Date and time</TableHead>
          <TableHead className="hidden md:table-cell">Expected attendance</TableHead>
          <TableHead className="hidden md:table-cell">Venues</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((e) => (
          <TableRow key={e.id} className={LINKED_ROW_CLASS} onClick={(ev) => openRowLink(ev, router.push, `/safety-checks/${encodeURIComponent(e.id)}`)}>
            <TableCell className="font-semibold text-foreground">
              <Link
                href={`/safety-checks/${encodeURIComponent(e.id)}`}
                aria-label={`Review ${e.name}`}
                className={`underline-offset-4 hover:underline ${ROW_LINK_FOCUS_CLASS}`}
              >
                {e.name}
              </Link>
            </TableCell>
            <TableCell className="whitespace-normal">
              {e.preferred_start_datetime ? formatEventDateTime(e.preferred_start_datetime, e.preferred_end_datetime) : NOT_SPECIFIED}
            </TableCell>
            <TableCell className="hidden md:table-cell">{e.expected_attendance ?? NOT_SPECIFIED}</TableCell>
            <TableCell className="hidden whitespace-normal md:table-cell">{e.venue_names.join(", ")}</TableCell>
            <TableCell><StatusBadge tone="info" label="Safety check" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
