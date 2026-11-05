import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { VenueBookingActions } from "@/components/VenueBookingActions";
import { VenueBookingDetail } from "@/components/VenueBookingDetail";
import { getVenueBooking } from "@/lib/venueBookingsServer";
import { BackLink, PAGE_MAIN } from "@/components/PageFrame";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue booking request · ConnectSphere" };

// SCRUM-33: one venue booking request. SCRUM-135: in the new style, in the shared shell.
export default async function VenueBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getVenueBooking(id);

  return (
    <main className={PAGE_MAIN}>
      <BackLink href="/venue-bookings" to="my venue bookings" />
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
