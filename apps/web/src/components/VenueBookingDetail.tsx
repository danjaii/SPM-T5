import Link from "next/link";
import { describeFlag } from "@spm-t5/shared";
import { bookingStatusLabel, type VenueBookingDetailView } from "@/lib/venueBookings";

// SCRUM-33/AC4: read-only view of one request: outcome, rejection reason, suggested alternative, amendment chain.
export function VenueBookingDetail({ booking }: { booking: VenueBookingDetailView }) {
  return (
    <section className="vb">
      <h1>{booking.eventName}</h1>
      <p className="event__status">
        Status <span className="status-badge">{bookingStatusLabel(booking.status)}</span>
      </p>

      {/* SCRUM-104/AC3: raised when the venue's setup or turnaround time was raised; change or cancel one booking to clear it */}
      {booking.flags.length > 0 && (
        <div className="alert alert--warning" aria-label="Flags">
          {booking.flags.map((f) => (
            <p key={f.id}>{describeFlag(f)}</p>
          ))}
          <p>Change or cancel this booking to resolve it.</p>
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
      </dl>

      {booking.rejectionReason && (
        <>
          <h2>Reason for rejection</h2>
          <p>{booking.rejectionReason}</p>
        </>
      )}

      {booking.suggestion && (
        <>
          <h2>Suggested alternative</h2>
          <p>
            {booking.suggestion.venueName} on {booking.suggestion.date},{" "}
            {booking.suggestion.startTime}–{booking.suggestion.endTime}
          </p>
        </>
      )}

      {booking.chain.length > 1 && (
        <>
          <h2>Amendment history</h2>
          <ol className="vb__list">
            {booking.chain.map((c) => (
              <li key={c.id}>
                {c.id === booking.id ? (
                  <strong>{c.venueName}, {c.date} {c.startTime}–{c.endTime}</strong>
                ) : (
                  <Link href={`/venue-bookings/${c.id}`}>{c.venueName}, {c.date} {c.startTime}–{c.endTime}</Link>
                )}{" "}
                <span className="status-badge">{bookingStatusLabel(c.status)}</span>
                {c.rejectionReason && <span className="vb__note">{c.rejectionReason}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
