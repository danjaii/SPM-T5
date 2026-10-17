import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { VenueBookingList } from "@/components/VenueBookingList";
import { getVenueBookings } from "@/lib/venueBookingsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue booking requests · ConnectSphere" };

// SCRUM-33: the coordinator tracks their venue booking requests.
export default async function VenueBookingsPage() {
  const result = await getVenueBookings();

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        <h1>Venue booking requests</h1>
        {"bookings" in result ? (
          <VenueBookingList bookings={result.bookings} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
