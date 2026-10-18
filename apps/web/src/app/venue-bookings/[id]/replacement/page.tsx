import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { ReplacementPicker } from "@/components/ReplacementPicker";
import { getReplacementCandidates, getVenueBooking } from "@/lib/venueBookingsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Find a replacement venue · ConnectSphere" };

// SCRUM-107/AC1: the venues that could replace a booking flagged as unavailable. venue-service refuses a booking that is not
// flagged, one that already has a replacement waiting, and anyone but the event's assigned coordinator; the reason is shown.
export default async function ReplacementVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const booking = await getVenueBooking(id);
  const options = "booking" in booking ? await getReplacementCandidates(id) : undefined;

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href={`/venue-bookings/${id}`}>← Back to the booking</Link>
        <h1>Find a replacement venue</h1>
        {"error" in booking ? (
          <div className="alert alert--error" role="alert">{booking.error}</div>
        ) : options && "error" in options ? (
          <div className="alert alert--error" role="alert">{options.error}</div>
        ) : options ? (
          <>
            <p>
              {booking.booking.eventName} is booked at {booking.booking.venueName} on {booking.booking.date},{" "}
              {booking.booking.startTime}–{booking.booking.endTime}, which is no longer available. These venues are free for the
              same period, including setup and turnaround, and hold at least {booking.booking.expectedAttendance ?? "the"} people.
              Date, time, attendance and requirements are copied from this booking.
            </p>
            <ReplacementPicker originalId={id} candidates={options.candidates} />
          </>
        ) : null}
      </main>
    </>
  );
}
