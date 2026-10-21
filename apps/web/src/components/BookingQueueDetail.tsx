import Link from "next/link";
import { unavailabilityFlagText } from "@spm-t5/shared";
import { StatusBadge } from "@/components/ui/status-badge";
import { SentBackNotice } from "./SentBackNotice";
import { formatSgt, suitabilityLabel, type QueueDetailView } from "@/lib/bookingQueue";
import { BOOKING_STATUS_DISPLAY, type BookingStatusKey } from "@/lib/status";
import { bookingStatusLabel } from "@/lib/venueBookings";

// SCRUM-37/AC6: one request, whatever its status. A decided one also shows who decided it, when, and why.
export function BookingQueueDetail({ booking }: { booking: QueueDetailView }) {
  return (
    <section className="vb">
      <h1>{booking.eventName}</h1>
      <p className="event__status">
        Status{" "}
        <StatusBadge {...(booking.status ? BOOKING_STATUS_DISPLAY[booking.status as BookingStatusKey] : undefined)} label={bookingStatusLabel(booking.status)} />
      </p>
      <SentBackNotice note={booking.sentBack} />

      {/* SCRUM-104/AC4: why Approve is missing, and the booking it clashes with */}
      {booking.flags.length > 0 && (
        <div className="alert alert--warning" aria-label="Flags">
          <strong>Flagged: {booking.flags.map((f) => f.label).join(", ")}</strong>
          <ul>
            {booking.flags.map((f) => (
              <li key={f.id}>
                {f.otherBookingId ? (
                  <Link href={`/booking-queue/${f.otherBookingId}`}>{f.otherEventName ?? "Another booking"}</Link>
                ) : f.unavailability ? null : (
                  f.label
                )}
                {f.otherPeriod && <> at this venue, {f.otherPeriod.date} {f.otherPeriod.startTime}–{f.otherPeriod.endTime}</>}
                {/* SCRUM-106/AC3: the block that raised it, in words */}
                {f.unavailability && <>{unavailabilityFlagText(f.unavailability, booking.venueName)}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

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
        <dt>Suitability</dt>
        <dd>{suitabilityLabel(booking.suitability)}</dd>
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

      {booking.suitability === "not_suitable" && (
        <section aria-label="Requirements not met">
          <h2>Requirements not met</h2>
          <ul>
            {booking.suitabilityUnmet.map((u) => (
              <li key={u.key}>
                <strong>{u.label}:</strong> {u.message}
              </li>
            ))}
          </ul>
          <h2>Coordinator&apos;s reason</h2>
          <p>{booking.suitabilityOverrideReason}</p>
        </section>
      )}

      {booking.rejectionReason && (
        <>
          <h2>Reason for rejection</h2>
          <p>{booking.rejectionReason}</p>
        </>
      )}

      {booking.amendsRequestId && (
        <p>
          <StatusBadge tone="info" label="Amends an earlier request" />{" "}
          <Link href={`/booking-queue/${booking.amendsRequestId}`}>View the earlier request</Link>
        </p>
      )}
    </section>
  );
}
