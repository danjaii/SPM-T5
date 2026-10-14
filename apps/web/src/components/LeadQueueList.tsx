import Link from "next/link";
import { formatSgt } from "@/lib/bookingQueue";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { LeadQueueItem } from "@/lib/leadServer";

const NOT_SPECIFIED = "Not specified";

// SCRUM-77/AC1-AC3, AC6: the requests waiting for a coordinator, in the order event-service sends them (oldest first).
export function LeadQueueList({ requests }: { requests: LeadQueueItem[] }) {
  if (requests.length === 0) return <p className="empty">No event requests are awaiting coordinator assignment.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Event Organiser</th>
            <th>Preferred date and time</th>
            <th>Expected attendance</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              {/* SCRUM-78/AC1: choosing a request opens its assign step */}
              <td><Link href={`/lead/events/${r.id}/assign`} aria-label={`Assign ${r.name}`}>{r.name}</Link></td>
              <td>{r.organiser_name ?? "Unknown"}</td>
              <td>{r.preferred_start_datetime ? formatEventDateTime(r.preferred_start_datetime, r.preferred_end_datetime) : NOT_SPECIFIED}</td>
              <td>{r.expected_attendance ?? NOT_SPECIFIED}</td>
              <td>{r.submitted_at ? formatSgt(r.submitted_at) : NOT_SPECIFIED}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
