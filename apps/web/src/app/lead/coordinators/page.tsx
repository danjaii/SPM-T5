import type { Metadata } from "next";
import { LeadCoordinatorList } from "@/components/LeadCoordinatorList";
import { LeadPage } from "@/components/LeadPage";
import { getLeadCoordinators } from "@/lib/leadServer";

// SCRUM-81/AC5: loaded per request, so opening or refreshing shows the current assignments
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Coordinator overview · ConnectSphere" };

// SCRUM-81: the coordinators the Lead supervises, with their workload. SCRUM-126: also the Lead's view of all active events
// (each coordinator opens to their events).
export default async function CoordinatorOverviewPage() {
  const result = await getLeadCoordinators();

  return (
    <LeadPage
      title="Coordinator overview"
      description="Each coordinator's active events. Open one to see the events they are running."
      error={"error" in result ? result.error : undefined}
    >
      {"coordinators" in result && <LeadCoordinatorList coordinators={result.coordinators} />}
    </LeadPage>
  );
}
