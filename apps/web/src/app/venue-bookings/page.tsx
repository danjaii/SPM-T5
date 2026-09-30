import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { VenueBookingList } from "@/components/VenueBookingList";
import { getVenueBookings } from "@/lib/venueBookings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue booking requests · ConnectSphere" };

// SCRUM-33: the coordinator tracks their venue booking requests.
export default async function VenueBookingsPage() {
  const result = await getVenueBookings();

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
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
