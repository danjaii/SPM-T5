import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <Link
        href="/booking-queue"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to booking requests
      </Link>
        {"booking" in result ? (
          <>
            <BookingQueueDetail booking={result.booking} />
            {suitability && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle className="text-base font-bold">Suitability</CardTitle>
                </CardHeader>
                <CardContent>
                  <SuitabilityReport report={suitability} />
                </CardContent>
              </Card>
            )}
            {/* SCRUM-38/39: renders only while the request is PENDING; the server checks again. */}
            <VenueStaffDecision booking={{ id: result.booking.id, status: result.booking.status, flagged: result.booking.flags.length > 0 }} />
          </>
        ) : (
          <AuthAlert tone="error">{result.error}</AuthAlert>
        )}
    </main>
  );
}
