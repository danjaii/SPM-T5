import Link from "next/link";
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
    <section className="event-section" aria-labelledby="technical-assignments-heading">
      <h2 id="technical-assignments-heading">On-site technical support</h2>
      {data.assignments.length === 0 ? (
        <p className="empty">No technical support staff assigned yet.</p>
      ) : (
        <table className="detail-table">
          <thead>
            <tr>
              <th>Technician</th>
              <th>Venue</th>
              <th>Date and time</th>
              <th>Note</th>
              <th>Status</th>
              {data.canAssign && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data.assignments.map((a) => (
              <tr key={a.id}>
                <td>{a.staffName ?? "Unknown"}</td>
                <td>{a.venueName ?? "No venue"}</td>
                <td>{period(a)}</td>
                <td>{a.note ?? "—"}</td>
                <td>
                  <span className="status-badge">{statusText(a)}</span>
                </td>
                {data.canAssign && (
                  <td className="vb__row-actions">
                    {a.status !== "CANCELLED" && (
                      <>
                        <Link className="btn btn--secondary" href={`/events/${eventId}/technical-assignments/${a.id}/change`}>
                          Change
                        </Link>
                        <TechnicalAssignmentCancel assignmentId={a.id} />
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.canAssign && (
        <div className="event-buttons">
          <Link className="btn btn--secondary" href={`/events/${eventId}/technical-assignments/new`}>
            Assign technical support staff
          </Link>
        </div>
      )}
    </section>
  );
}
