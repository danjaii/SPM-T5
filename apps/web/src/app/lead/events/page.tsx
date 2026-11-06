import type { Metadata } from "next";
import { LeadActiveEvents } from "@/components/LeadActiveEvents";
import { PageFrame } from "@/components/PageFrame";
import { getLeadActiveEvents } from "@/lib/leadServer";

// Loaded per request, so opening or refreshing shows the current assignments
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Active events · ConnectSphere" };

// SCRUM-189: every active event in one list, with who is running it; the Coordinator overview still groups them by coordinator.
export default async function LeadActiveEventsPage() {
  const result = await getLeadActiveEvents();

  return (
    <PageFrame
      title="Active events"
      description="Every event with a coordinator that is not yet completed, cancelled or rejected. Earliest first."
      error={"error" in result ? result.error : undefined}
    >
      {"events" in result && <LeadActiveEvents events={result.events} />}
    </PageFrame>
  );
}
