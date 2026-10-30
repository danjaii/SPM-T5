import type { Metadata } from "next";
import { LeadDashboardOverview } from "@/components/LeadDashboardOverview";
import { PageFrame } from "@/components/PageFrame";
import { NeedsAction } from "@/components/shell/NeedsAction";
import { getLeadCoordinators, getLeadQueue } from "@/lib/leadServer";

// Rendered per request: the content depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event Coordinator Lead dashboard · ConnectSphere" };

/**
 * SCRUM-75/AC4, SCRUM-162: the Lead's overview. Counts and a short workload summary only; the requests and the full coordinator
 * list stay on /lead/queue and /lead/coordinators. A failed source leaves its figures "Unavailable" rather than 0.
 */
export default async function EventCoordinatorLeadDashboard() {
  const [queue, coordinators] = await Promise.all([getLeadQueue(), getLeadCoordinators()]);

  return (
    <PageFrame title="Dashboard" description="What is waiting for you and how your coordinators are loaded.">
      <NeedsAction />
      <LeadDashboardOverview
        unassigned={"requests" in queue ? queue.requests.length : undefined}
        coordinators={"coordinators" in coordinators ? coordinators.coordinators : undefined}
      />
    </PageFrame>
  );
}
