import Link from "next/link";
import { EmptyNote, EventSection } from "@/components/event/EventSection";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatSgt } from "@/lib/bookingQueue";
import type { EventTechnicalAssignmentsView, TechnicalAssignmentView } from "@/lib/technicalAssignments";
import { TechnicalAssignmentCancel } from "./TechnicalAssignmentCancel";

/** "2099-10-15 08:00–17:00", or with the end date when it ends on another day. */
function period(a: TechnicalAssignmentView): string {
  const end = a.endDate === a.startDate ? a.endTime : `${a.endDate} ${a.endTime}`;
  return `${a.startDate} ${a.startTime}–${end}`;
}

/** AC5: Assigned, Acknowledged (when) or Cancelled (why), always in words. */
function statusText(a: TechnicalAssignmentView): string {
  if (a.status === "ACKNOWLEDGED" && a.acknowledgedAt) return `Acknowledged on ${formatSgt(a.acknowledgedAt)}`;
  if (a.status === "CANCELLED") return a.cancellationReason ? `Cancelled: ${a.cancellationReason}` : "Cancelled";
  return a.statusLabel;
}

// SCRUM-20: the event's on-site technical support, for its coordinator (equipment-service answers nobody else; null means
// no section). They assign, change and cancel; the technician is notified each time and acknowledges.
export function EventTechnicalAssignments({ eventId, data }: { eventId: string; data: EventTechnicalAssignmentsView | null }) {
  if (!data) return null;
  return (
    <EventSection
      id="technical-assignments-heading"
      title="On-site technical support"
      action={data.canAssign && (
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={`/events/${eventId}/technical-assignments/new`}>
          Assign technical support staff
        </Link>
      )}
    >
      {data.assignments.length === 0 ? (
        <EmptyNote>No technical support staff assigned yet.</EmptyNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Technician</TableHead>
              <TableHead>Venue</TableHead>
              <TableHead>Date and time</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Status</TableHead>
              {data.canAssign && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.assignments.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.staffName ?? "Unknown"}</TableCell>
                <TableCell>{a.venueName ?? "No venue"}</TableCell>
                <TableCell>{period(a)}</TableCell>
                <TableCell className="whitespace-normal">{a.note ?? "—"}</TableCell>
                <TableCell className="whitespace-normal">
                  <StatusBadge tone={a.status === "ACKNOWLEDGED" ? "success" : a.status === "CANCELLED" ? "neutral" : "info"} label={statusText(a)} className="h-auto whitespace-normal" />
                </TableCell>
                {data.canAssign && (
                  <TableCell>
                    {a.status !== "CANCELLED" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={`/events/${eventId}/technical-assignments/${a.id}/change`}>
                          Change
                        </Link>
                        <TechnicalAssignmentCancel assignmentId={a.id} />
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </EventSection>
  );
}
