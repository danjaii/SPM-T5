import type { Metadata } from "next";
import { CoordinatorDashboardOverview } from "@/components/CoordinatorDashboardOverview";
import { PageFrame } from "@/components/PageFrame";
import { getCoordinatorDashboard } from "@/lib/coordinatorDashboardServer";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event Coordinator dashboard · ConnectSphere" };

/**
 * SCRUM-160: what the coordinator should act on first, then their events and venue booking requests by status. The lists
 * themselves stay on Event requests and My venue bookings. A failed source leaves its part "Unavailable".
 */
export default async function EventCoordinatorDashboard() {
  return (
    <PageFrame title="Dashboard" description="What needs your attention and where your events and bookings stand.">
      <CoordinatorDashboardOverview {...(await getCoordinatorDashboard())} />
    </PageFrame>
  );
}
