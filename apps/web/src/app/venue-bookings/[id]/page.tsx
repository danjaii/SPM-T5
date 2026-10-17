import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { VenueBookingActions } from "@/components/VenueBookingActions";
import { VenueBookingDetail } from "@/components/VenueBookingDetail";
import { getVenueBooking } from "@/lib/venueBookingsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue booking request · ConnectSphere" };

// SCRUM-33: one venue booking request, read-only.
export default async function VenueBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getVenueBooking(id);

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/venue-bookings">← Back to venue booking requests</Link>
        {"booking" in result ? (
          <>
            <VenueBookingDetail booking={result.booking} />
            <VenueBookingActions booking={result.booking} />
          </>
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
