import type { Metadata } from "next";
import Link from "next/link";
import { LeadKpiCards } from "@/components/LeadKpiCards";
import { LeadPage } from "@/components/LeadPage";
import { LeadQueueList } from "@/components/LeadQueueList";
import { LeadWorkloadPanel } from "@/components/LeadWorkloadPanel";
import { buttonVariants } from "@/components/ui/button";
import { leadKpis } from "@/lib/leadQueueView";
import { getLeadCoordinators, getLeadQueue, getLeadSummary } from "@/lib/leadServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Unassigned queue · ConnectSphere" };

// SCRUM-77: the Lead's queue of event requests waiting for an Event Coordinator.
// SCRUM-126/AC1, AC2, AC5, AC11: Figma 04 inside the shared shell. The queue decides whether the page works; the
// coordinators and the summary only add to it, so a failure there leaves their parts out rather than hiding the queue.
export default async function LeadQueuePage() {
  const [queue, coordinators, summary] = await Promise.all([getLeadQueue(), getLeadCoordinators(), getLeadSummary()]);
  const eligible = "coordinators" in coordinators ? coordinators.coordinators : undefined;

  return (
    <LeadPage
      title="Unassigned queue"
      description="New requests wait here until you give them a coordinator. Oldest first."
      action={
        <Link className={buttonVariants({ variant: "outline" })} href="/lead/coordinators">
          View all active events
        </Link>
      }
      error={"error" in queue ? queue.error : undefined}
    >
      {"requests" in queue && (
        <>
          <LeadKpiCards kpis={leadKpis(queue.requests, eligible, "summary" in summary ? summary.summary : undefined)} />
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <LeadQueueList requests={queue.requests} coordinators={eligible} />
            {eligible && <LeadWorkloadPanel coordinators={eligible} />}
          </div>
        </>
      )}
    </LeadPage>
  );
}
