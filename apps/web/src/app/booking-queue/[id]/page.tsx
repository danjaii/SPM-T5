import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { BookingQueueDetail } from "@/components/BookingQueueDetail";
import { VenueStaffDecision } from "@/components/VenueStaffDecision";
import { SuitabilityReport } from "@/components/SuitabilityReport";
import { getQueuedBooking } from "@/lib/bookingQueueServer";
import { getSuitability } from "@/lib/venueSuitabilityServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Booking request · ConnectSphere" };

// SCRUM-37: one venue booking request, opened from the queue or by its address.
export default async function QueuedBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getQueuedBooking(id);
  // SCRUM-109: how well the requested venue suits the event, as information for the decision. The request holds
  // its own slot, so availability is left out (it would only clash with itself).
  const suitability =
    "booking" in result
      ? await getSuitability({
          venueId: result.booking.venueId,
          eventId: result.booking.eventId,
          date: result.booking.date,
          startTime: result.booking.startTime,
          endTime: result.booking.endTime,
          attendance: result.booking.expectedAttendance,
          skipAvailability: true,
        })
      : null;

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/booking-queue">← Back to pending booking requests</Link>
        {"booking" in result ? (
          <>
            <BookingQueueDetail booking={result.booking} />
            {suitability && (
              <section>
                <h2>Suitability</h2>
                <SuitabilityReport report={suitability} />
              </section>
            )}
            {/* SCRUM-38/39: renders only while the request is PENDING; the server checks again. */}
            <VenueStaffDecision booking={{ id: result.booking.id, status: result.booking.status, flagged: result.booking.flags.length > 0 }} />
          </>
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
