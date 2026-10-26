import Link from "next/link";
import { isDraft, isUntitledDraft, UNTITLED_DRAFT, type MyEventRequest } from "@/lib/myEventRequests";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EventStatusBadge from "./EventStatusBadge";

// Event dates are shown in Singapore time, like the rest of the app
const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" }) : "—";

/** SCRUM-52/AC1: the organiser's requests with their current status; each name opens the request (AC3). */
export function MyEventRequestsTable({ requests }: { requests: MyEventRequest[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Preferred start</TableHead>
          <TableHead>Expected attendance</TableHead>
          <TableHead>Submitted</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((request) => (
          <TableRow key={request.id} data-draft={isDraft(request) ? "true" : undefined} className={isDraft(request) ? "bg-muted/50" : undefined}>
            <TableCell className="font-semibold text-foreground">
              <Link href={`/events/${encodeURIComponent(request.id)}`} className="underline-offset-4 hover:underline">
                {isUntitledDraft(request) ? <span className="font-normal text-muted-foreground italic">{UNTITLED_DRAFT}</span> : request.name}
              </Link>
              {/* SCRUM-55/AC2: a draft is labelled in words as well as by its badge and tint */}
              {isDraft(request) && <p className="text-xs font-normal text-muted-foreground">Not submitted yet</p>}
            </TableCell>
            <TableCell>
              <EventStatusBadge status={request.status} />
            </TableCell>
            <TableCell>{formatDate(request.preferred_start_datetime)}</TableCell>
            <TableCell>{request.expected_attendance ?? "—"}</TableCell>
            <TableCell>{isDraft(request) ? "Not submitted" : formatDate(request.submitted_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
