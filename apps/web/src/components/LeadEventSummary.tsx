import type { ReactNode } from "react";
import { formatSgt } from "@/lib/bookingQueue";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { LeadEvent } from "@/lib/leadServer";

const NOT_SPECIFIED = "Not specified";

// SCRUM-78 / SCRUM-79: the event, as the Lead sees it while assigning or reassigning its coordinator. One row per
// detail, label on the left, so the Lead can scan it before choosing a coordinator. A reassignment also shows who holds
// the event now (SCRUM-79/AC2).
export function LeadEventSummary({ event, coordinator }: { event: LeadEvent; coordinator?: string }) {
  const rows: [string, ReactNode][] = [
    ...(coordinator ? [["Current coordinator", coordinator] as [string, ReactNode]] : []),
    ["Event Organiser", event.organiser_name ?? "Unknown"],
    ["Preferred date and time", event.preferred_start_datetime ? formatEventDateTime(event.preferred_start_datetime, event.preferred_end_datetime) : NOT_SPECIFIED],
    ["Expected attendance", event.expected_attendance ?? NOT_SPECIFIED],
    ["Submitted", event.submitted_at ? formatSgt(event.submitted_at) : NOT_SPECIFIED],
  ];

  return (
    <div className="event-detail-card event-detail-card--table lead-summary">
      <table className="detail-table" aria-label="Event details">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
