import Link from "next/link";
import { describeFlag } from "@spm-t5/shared";
import { bookingStatusLabel, type VenueBookingListItem } from "@/lib/venueBookings";

const formatDecided = (iso: string) =>
  new Date(iso).toLocaleDateString("en-SG", { dateStyle: "medium", timeZone: "Asia/Singapore" });

// SCRUM-33/AC1: the coordinator's requests, with status and (for decided ones only) the decision date.
export function VenueBookingList({ bookings }: { bookings: VenueBookingListItem[] }) {
  if (bookings.length === 0) return <p className="empty">You have no venue booking requests.</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Event</th>
            <th>Venue</th>
            <th>Date</th>
            <th>Time</th>
            <th>Status</th>
            <th>Decided</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id}>
              <td><Link href={`/venue-bookings/${b.id}`}>{b.eventName}</Link></td>
              <td>{b.venueName}</td>
              <td>{b.date}</td>
              <td>{b.startTime}–{b.endTime}</td>
              <td>
                <span className="status-badge">{bookingStatusLabel(b.status)}</span>
                {/* SCRUM-104/AC3: the flag and the other booking's time, as text */}
                {b.flags.map((f) => (
                  <span className="vb__note vb__flag" key={f.id}>{describeFlag(f)}</span>
                ))}
              </td>
              <td>
                {(b.status === "APPROVED" || b.status === "REJECTED") && b.decidedAt ? formatDecided(b.decidedAt) : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
