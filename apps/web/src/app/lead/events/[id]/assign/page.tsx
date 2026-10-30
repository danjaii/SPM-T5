import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { isClosedEventStatus } from "@spm-t5/shared";
import { LeadAssignForm } from "@/components/LeadAssignForm";
import { LeadEventSummary } from "@/components/LeadEventSummary";
import { PageFrame } from "@/components/PageFrame";
import { buttonVariants } from "@/components/ui/button";
import { getLeadAssignment } from "@/lib/leadServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Assign a coordinator · ConnectSphere" };

// SCRUM-78: the Lead assigns an unassigned event request to one of their coordinators, opened from the queue.
// SCRUM-168/AC7: inside the shared page frame like the other Lead pages.
export default async function LeadAssignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getLeadAssignment(id);

  return (
    <PageFrame
      title={"assignment" in result ? `Assign a coordinator to ${result.assignment.event.name}` : "Assign a coordinator"}
      description="Choose who will run this event. Clashes are shown so you can choose with the dates in mind."
      action={
        <Link className={buttonVariants({ variant: "outline" })} href="/lead/queue">
          <ArrowLeft aria-hidden="true" />
          Back to unassigned event requests
        </Link>
      }
      error={"error" in result ? result.error : undefined}
    >
      {"assignment" in result && (
        <>
          <LeadEventSummary event={result.assignment.event} />
          {result.assignment.canAssign ? (
            <LeadAssignForm eventId={id} eventName={result.assignment.event.name} coordinators={result.assignment.coordinators} />
          ) : (
            // SCRUM-78/AC6 (closed) and AC3 (already assigned): no assign action
            <p role="status" className="flex items-start gap-2 rounded-lg border border-status-info-fg bg-status-info p-4 text-sm text-status-info-fg">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {isClosedEventStatus(result.assignment.event.status)
                ? "This event is closed, so a coordinator can't be assigned."
                : "This event already has a coordinator."}
            </p>
          )}
        </>
      )}
    </PageFrame>
  );
}
