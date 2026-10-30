import Link from "next/link";
import type { MyEventRequest } from "@/lib/myEventRequests";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatLastSaved } from "@/lib/formatLastSaved";
import { DeleteDraftButton } from "./DeleteDraftButton";
import EventStatusBadge from "./EventStatusBadge";

// Event dates are shown in Singapore time, like the rest of the app
const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" }) : "—";

/** SCRUM-52/AC1: the organiser's requests with their current status; each name opens the request (AC3); a draft opens the form with it loaded (SCRUM-54/AC1). */
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
          <TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {requests.map((request) => (
          <TableRow key={request.id}>
            <TableCell className="font-semibold text-foreground">
              <Link href={request.status === "draft" ? `/events/new?draft=${encodeURIComponent(request.id)}` : `/events/${encodeURIComponent(request.id)}`} className="underline-offset-4 hover:underline">
                {request.name}
              </Link>
            </TableCell>
            <TableCell>
              <EventStatusBadge status={request.status} />
            </TableCell>
            <TableCell>{formatDate(request.preferred_start_datetime)}</TableCell>
            <TableCell>{request.expected_attendance ?? "—"}</TableCell>
            {/* SCRUM-53/AC3: a draft has not been submitted, so its column says when it was last saved */}
            <TableCell>
              {request.status === "draft" && request.updated_at ? `Last saved ${formatLastSaved(request.updated_at)}` : formatDate(request.submitted_at)}
            </TableCell>
            <TableCell>
              {/* SCRUM-56/AC2: only a draft can be deleted, so any other status has no Delete control at all */}
              {request.status === "draft" && <DeleteDraftButton id={request.id} name={request.name} />}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
