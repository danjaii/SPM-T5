import type { Metadata } from "next";
import { AffectedBookings } from "@/components/AffectedBookings";
import { DashboardView } from "@/components/DashboardView";
import { getDashboard } from "@/lib/dashboard";
import { getVenueBookings } from "@/lib/venueBookingsServer";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event Coordinator dashboard · ConnectSphere" };

export default async function EventCoordinatorDashboard() {
  const [data, venueBookings] = await Promise.all([getDashboard("event_coordinator"), getVenueBookings()]);
  return (
    <DashboardView data={data}>
      {/* SCRUM-135/AC2: the bookings a turnaround change or an unavailable venue has put in doubt, kept and listed */}
      <AffectedBookings {...("bookings" in venueBookings ? { bookings: venueBookings.bookings } : { error: venueBookings.error })} />
    </DashboardView>
  );
}
