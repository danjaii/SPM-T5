import Link from "next/link";
import { formatSgt, type QueueDetailView } from "@/lib/bookingQueue";
import { bookingStatusLabel } from "@/lib/venueBookings";

// SCRUM-37/AC6: one request, whatever its status. A decided one also shows who decided it, when, and why.
export function BookingQueueDetail({ booking }: { booking: QueueDetailView }) {
  return (
    <section className="vb">
      <h1>{booking.eventName}</h1>
      <p className="event__status">
        Status <span className="status-badge">{bookingStatusLabel(booking.status)}</span>
      </p>

      <dl className="vb__facts">
        <dt>Venue</dt>
        <dd>{booking.venueName}</dd>
        <dt>Date</dt>
        <dd>{booking.date}</dd>
        <dt>Time</dt>
        <dd>{booking.startTime}–{booking.endTime}</dd>
        <dt>Expected attendance</dt>
        <dd>{booking.expectedAttendance ?? "Not specified"}</dd>
        <dt>Venue requirements</dt>
        <dd>{booking.venueRequirements || "None specified"}</dd>
        <dt>Accessibility needs</dt>
        <dd>{booking.accessibilityNeeds || "None specified"}</dd>
        <dt>Requested by</dt>
        <dd>{booking.requestedByName ?? "Unknown"}</dd>
        <dt>Submitted</dt>
        <dd>{formatSgt(booking.submittedAt)}</dd>
        {booking.decidedAt && (
          <>
            <dt>Decided by</dt>
            <dd>{booking.decidedByName ?? "Unknown"}</dd>
            <dt>Decided</dt>
            <dd>{formatSgt(booking.decidedAt)}</dd>
          </>
        )}
      </dl>

      {booking.rejectionReason && (
        <>
          <h2>Reason for rejection</h2>
          <p>{booking.rejectionReason}</p>
        </>
      )}

      {booking.amendsRequestId && (
        <p>
          <span className="status-badge">Amends an earlier request</span>{" "}
          <Link href={`/booking-queue/${booking.amendsRequestId}`}>View the earlier request</Link>
        </p>
      )}
    </section>
  );
}
