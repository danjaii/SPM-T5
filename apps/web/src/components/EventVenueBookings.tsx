import Link from "next/link";
import { describeFlag } from "@spm-t5/shared";
import { VenueBookingCancel } from "./VenueBookingCancel";
import type { EquipmentRequestView } from "@/lib/equipmentRequests";
import { bookingStatusLabel, equipmentFor, isChangeableVenueBooking, type EventVenueBookingItem } from "@/lib/venueBookings";

// SCRUM-98/AC5: every venue booking of the event, each with its venue, date, times and status, including rejected and
// withdrawn ones (98-S23). Shown to the assigned Coordinator only (venue-service answers nobody else); null means no
// section. Replaces SCRUM-38's single approved venue (38-S4): approved venue bookings are in this list too.
// SCRUM-102/AC1, AC2: while the event can still have venues (`canChange`), each pending or approved venue booking can be
// changed or cancelled; `equipment` is the event's equipment requests, so cancelling can say what it releases (AC7).
export function EventVenueBookings({
  bookings,
  canChange = false,
  equipment = [],
}: {
  bookings: EventVenueBookingItem[] | null;
  canChange?: boolean;
  equipment?: EquipmentRequestView[];
}) {
  if (!bookings) return null;
  return (
    <section className="event-section" aria-labelledby="venue-bookings-heading">
      <h2 id="venue-bookings-heading">Venue bookings</h2>
      {bookings.length === 0 ? (
        <p className="event-detail-card event-detail-card--quiet">No venue has been requested for this event yet.</p>
      ) : (
        <div className="event-detail-card event-detail-card--table">
          <table>
            <thead>
              <tr>
                <th>Venue</th>
                <th>Date</th>
                <th>Time</th>
                <th>Attendance</th>
                <th>Status</th>
                {canChange && <th><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td><Link href={`/venue-bookings/${b.id}`}>{b.venueName}</Link></td>
                  <td>{b.date}</td>
                  <td>{b.startTime}–{b.endTime}</td>
                  <td>
                    {b.expectedAttendance ?? "Not specified"}
                    {/* 98-S10: a warning, never a refusal; venue staff decide */}
                    {b.exceedsCapacity && <span className="capacity-flag">More people than this venue holds</span>}
                  </td>
                  <td>
                    <span className="status-badge">{bookingStatusLabel(b.status)}</span>
                    {b.flags.map((f) => (
                      <span className="vb__note vb__flag" key={f.id}>{describeFlag(f)}</span>
                    ))}
                    {b.rejectionReason && <span className="vb__note">{b.rejectionReason}</span>}
                    {b.cancellationReason && <span className="vb__note">{b.cancellationReason}</span>}
                  </td>
                  {canChange && (
                    <td className="vb__row-actions">
                      {isChangeableVenueBooking(b.status) && (
                        <>
                          <Link className="btn btn--secondary" href={`/venue-bookings/${b.id}/change`} aria-label={`Change the ${b.venueName} venue booking`}>
                            Change
                          </Link>{" "}
                          <VenueBookingCancel booking={b} equipment={equipmentFor(equipment, b.id)} />
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
