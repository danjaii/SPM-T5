import type { EventVenueBookingView } from "@/lib/venueBookings";

// SCRUM-38/AC4: the venue Venue Staff approved for this event. Shown to the assigned Coordinator only
// (the server answers nobody else); no approved booking means no section.
export function EventVenueBooking({ booking }: { booking: EventVenueBookingView | null }) {
  if (!booking) return null;
  return (
    <section className="event">
      <h2>Venue booking</h2>
      <dl className="vb__facts">
        <dt>Venue</dt>
        <dd>{booking.venueName}</dd>
        <dt>When</dt>
        <dd>
          {booking.date}, {booking.startTime}–{booking.endTime}
        </dd>
      </dl>
    </section>
  );
}
