import type { Metadata } from "next";
import { LeadCoordinatorEvents } from "@/components/LeadCoordinatorEvents";
import { PageFrame } from "@/components/PageFrame";
import { getCoordinatorEvents, getLeadCoordinators } from "@/lib/leadServer";

// SCRUM-81/AC5: loaded per request, so opening or refreshing shows the current assignments
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Coordinator's active events · ConnectSphere" };

// SCRUM-81/AC2: one coordinator's non-closed events, opened from the coordinator overview. Inside the shared shell like the
// other Lead pages (no top bar), with the error shown by PageFrame.
export default async function CoordinatorEventsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, overview] = await Promise.all([getCoordinatorEvents(id), getLeadCoordinators()]);
  const coordinator = "coordinators" in overview ? overview.coordinators.find((c) => c.id === id) : undefined;

  return (
    <PageFrame
      title={coordinator ? `${coordinator.full_name}'s active events` : "Coordinator's active events"}
      description="Events still in progress. Open one to reassign it to another coordinator."
      back={{ href: "/lead/coordinators", to: "coordinator overview" }}
      error={"error" in result ? result.error : undefined}
    >
      {"events" in result && <LeadCoordinatorEvents events={result.events} />}
    </PageFrame>
  );
}
