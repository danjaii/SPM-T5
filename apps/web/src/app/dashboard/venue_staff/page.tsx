import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/PageFrame";
import { VenueStaffDashboardOverview } from "@/components/VenueStaffDashboardOverview";
import { buttonVariants } from "@/components/ui/button";
import { getBookingQueue, getVenueBlocks, getVenueSchedule } from "@/lib/bookingQueueServer";
import { getDashboard } from "@/lib/dashboard";
import { greeting, summaryLine } from "@/lib/venueStaffDashboard";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue Staff dashboard · ConnectSphere" };

/**
 * SCRUM-163: what Venue Staff decide first (flagged requests on top), then today's schedule. The full lists stay on Booking
 * requests and the Venue catalogue. A source that failed leaves its part "Unavailable".
 */
export default async function VenueStaffDashboard() {
  const [data, queue, schedule, blocks] = await Promise.all([getDashboard("venue_staff"), getBookingQueue(), getVenueSchedule(), getVenueBlocks()]);
  const requests = "requests" in queue ? queue.requests : undefined;
  return (
    <PageFrame
      title={greeting(data.user.fullName)}
      description={summaryLine(requests)}
      action={<Link href="/booking-queue" className={buttonVariants()}>Review requests</Link>}
    >
      <VenueStaffDashboardOverview requests={requests} schedule={schedule} blocks={blocks} />
    </PageFrame>
  );
}
