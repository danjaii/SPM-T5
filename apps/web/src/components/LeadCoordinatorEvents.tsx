import { CalendarX } from "lucide-react";
import Link from "next/link";
import EventStatusBadge from "@/components/EventStatusBadge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { LeadCoordinatorEvent } from "@/lib/leadServer";

const NOT_SPECIFIED = "Not specified";

// SCRUM-81/AC2-AC4: one coordinator's non-closed events, in the same table style as the coordinator overview.
export function LeadCoordinatorEvents({ events }: { events: LeadCoordinatorEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card px-6 py-10 text-center">
        <CalendarX className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">This coordinator has no active events.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Preferred date and time</TableHead>
            <TableHead>Expected attendance</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => (
            <TableRow key={e.id}>
              {/* SCRUM-79/AC1: choosing an event opens its reassign step */}
              <TableCell className="font-medium">
                <Link className="underline-offset-4 hover:underline" href={`/lead/events/${e.id}/reassign`} aria-label={`Reassign ${e.name}`}>
                  {e.name}
                </Link>
              </TableCell>
              <TableCell><EventStatusBadge status={e.status} /></TableCell>
              <TableCell>
                {e.preferred_start_datetime ? formatEventDateTime(e.preferred_start_datetime, e.preferred_end_datetime) : NOT_SPECIFIED}
              </TableCell>
              <TableCell>{e.expected_attendance ?? NOT_SPECIFIED}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
