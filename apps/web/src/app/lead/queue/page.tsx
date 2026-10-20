import type { Metadata } from "next";
import { LeadPage } from "@/components/LeadPage";
import { LeadQueueList } from "@/components/LeadQueueList";
import { getLeadQueue } from "@/lib/leadServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Unassigned queue · ConnectSphere" };

// SCRUM-77: the Lead's queue of event requests waiting for an Event Coordinator.
// SCRUM-126/AC1, AC5, AC11: inside the shared shell, with designed loading (loading.tsx), empty and error states.
export default async function LeadQueuePage() {
  const result = await getLeadQueue();

  return (
    <LeadPage
      title="Unassigned queue"
      description="New requests wait here until you give them a coordinator. Oldest first."
      error={"error" in result ? result.error : undefined}
    >
      {"requests" in result && <LeadQueueList requests={result.requests} />}
    </LeadPage>
  );
}
