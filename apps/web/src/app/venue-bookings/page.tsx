import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueBookingList } from "@/components/VenueBookingList";
import { getVenueBookings } from "@/lib/venueBookingsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue booking requests · ConnectSphere" };

// SCRUM-33: the coordinator tracks their venue booking requests. SCRUM-135: in the new style, in the shared shell.
export default async function VenueBookingsPage() {
  const result = await getVenueBookings();

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to dashboard
      </Link>
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground">Venue booking requests</h1>
      {"bookings" in result ? <VenueBookingList bookings={result.bookings} /> : <AuthAlert tone="error">{result.error}</AuthAlert>}
    </main>
  );
}
