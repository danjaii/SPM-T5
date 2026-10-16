import Link from "next/link";
import { formatSgt, suitabilityLabel, type QueueItemView } from "@/lib/bookingQueue";

// SCRUM-37/AC1, AC4, AC5: pending requests in the order they arrive, with the event details attached.
export function BookingQueueList({ requests }: { requests: QueueItemView[] }) {
  if (requests.length === 0) return <p className="empty">No pending booking requests.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Venue</th>
            <th>Date</th>
            <th>Time</th>
            <th>Attendance</th>
            <th>Venue requirements</th>
            <th>Accessibility needs</th>
            <th>Suitability</th>
            <th>Requested by</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/booking-queue/${r.id}`}>{r.eventName}</Link>
                {r.amendsRequestId && <span className="status-badge">Amends an earlier request</span>}
                {/* SCRUM-104/AC4: text, not colour alone */}
                {r.flags.length > 0 && <span className="status-badge status-badge--flag">Flagged: {r.flags.map((f) => f.label).join(", ")}</span>}
              </td>
              <td>{r.venueName}</td>
              <td>{r.date}</td>
              <td>{r.startTime}–{r.endTime}</td>
              <td>{r.expectedAttendance ?? "Not specified"}</td>
              <td>{r.venueRequirements || "None specified"}</td>
              <td>{r.accessibilityNeeds || "None specified"}</td>
              <td>{suitabilityLabel(r.suitability)}</td>
              <td>{r.requestedByName ?? "Unknown"}</td>
              <td>{formatSgt(r.submittedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
