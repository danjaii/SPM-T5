import type { Metadata } from "next";
import { PageFrame } from "@/components/PageFrame";
import { VenueBookingList } from "@/components/VenueBookingList";
import { getVenueBookings } from "@/lib/venueBookingsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "My venue bookings · ConnectSphere" };

// SCRUM-33: the coordinator tracks their venue booking requests. SCRUM-135: in the new style, in the shared shell.
// SCRUM-186/AC2, AC4: a sidebar page, so no back link, and titled as the sidebar names it.
export default async function VenueBookingsPage() {
  const result = await getVenueBookings();

  return (
    <PageFrame title="My venue bookings" error={"bookings" in result ? undefined : result.error}>
      {"bookings" in result && <VenueBookingList bookings={result.bookings} />}
    </PageFrame>
  );
}
