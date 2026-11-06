"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { isDraft, isUntitledDraft, UNTITLED_DRAFT, type MyEventRequest } from "@/lib/myEventRequests";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatLastSaved } from "@/lib/formatLastSaved";
import { LINKED_ROW_CLASS, openRowLink, ROW_LINK_FOCUS_CLASS } from "@/lib/rowLink";
import { DeleteDraftButton } from "./DeleteDraftButton";
import EventStatusBadge from "./EventStatusBadge";

// Event dates are shown in Singapore time, like the rest of the app
const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Singapore" }) : "—";

/** SCRUM-52/AC1: the organiser's requests with their current status; each name opens the request (AC3); a draft opens the form with it loaded (SCRUM-54/AC1). */
// SCRUM-159/AC2: the whole row opens the request too (SCRUM-151); the name stays the link for keyboard users.
export function MyEventRequestsTable({ requests }: { requests: MyEventRequest[] }) {
  const router = useRouter();
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
        {requests.map((request) => {
          // a draft opens the form with it loaded, so the row and the name go to the same place (SCRUM-54/AC1)
          const href = isDraft(request) ? `/events/new?draft=${encodeURIComponent(request.id)}` : `/events/${encodeURIComponent(request.id)}`;
          return (
            <TableRow
              key={request.id}
              data-draft={isDraft(request) ? "true" : undefined}
              className={isDraft(request) ? `${LINKED_ROW_CLASS} bg-muted/50` : LINKED_ROW_CLASS}
              onClick={(e) => openRowLink(e, router.push, href)}
            >
              <TableCell className="font-semibold text-foreground">
                <Link href={href} className={`underline-offset-4 hover:underline ${ROW_LINK_FOCUS_CLASS}`}>
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
              {/* SCRUM-53/AC3: a draft has not been submitted, so its column says when it was last saved (SCRUM-55/AC2: or that it is not submitted) */}
              <TableCell>
                {isDraft(request) ? (request.updated_at ? `Last saved ${formatLastSaved(request.updated_at)}` : "Not submitted") : formatDate(request.submitted_at)}
              </TableCell>
              {/* SCRUM-56/AC2: only a draft can be deleted, so any other status has no Delete control at all.
                  The click stops here: the dialog is portalled but its clicks still bubble to the row, which would open the draft. */}
              <TableCell onClick={(e) => e.stopPropagation()}>
                {isDraft(request) && (
                  <div className="flex items-center justify-end gap-3">
                    {/* SCRUM-124/AC2 (Figma 02): the row's action for a draft. A cue, not a second link: the whole row opens the draft
                        (SCRUM-159) and the name stays the one link for keyboard users, so the list of links is unchanged. */}
                    <span data-testid="continue-editing" className="text-sm font-semibold text-fg-primary">Continue editing →</span>
                    <DeleteDraftButton id={request.id} name={isUntitledDraft(request) ? UNTITLED_DRAFT : request.name} />
                  </div>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
