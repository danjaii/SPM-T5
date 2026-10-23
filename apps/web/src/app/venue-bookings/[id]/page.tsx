import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueBookingActions } from "@/components/VenueBookingActions";
import { VenueBookingDetail } from "@/components/VenueBookingDetail";
import { getVenueBooking } from "@/lib/venueBookingsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue booking request · ConnectSphere" };

// SCRUM-33: one venue booking request. SCRUM-135: in the new style, in the shared shell.
export default async function VenueBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getVenueBooking(id);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <Link
        href="/venue-bookings"
        className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to venue booking requests
      </Link>
      {"booking" in result ? (
        <div className="flex flex-col gap-4">
          <VenueBookingDetail booking={result.booking} />
          <VenueBookingActions booking={result.booking} />
        </div>
      ) : (
        <AuthAlert tone="error">{result.error}</AuthAlert>
      )}
    </main>
  );
}
