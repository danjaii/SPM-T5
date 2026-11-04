import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { isClosedEventStatus } from "@spm-t5/shared";
import { LeadAssignForm } from "@/components/LeadAssignForm";
import { LeadEventSummary } from "@/components/LeadEventSummary";
import { PageFrame } from "@/components/PageFrame";
import { buttonVariants } from "@/components/ui/button";
import { getLeadReassignment } from "@/lib/leadServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reassign a coordinator · ConnectSphere" };

// SCRUM-79: the Lead hands an event held by one of their coordinators to another, opened from that coordinator's events.
// SCRUM-168/AC7: inside the shared page frame like the other Lead pages.
export default async function LeadReassignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getLeadReassignment(id);
  const back = "reassignment" in result && result.reassignment.current
    ? `/lead/coordinators/${result.reassignment.current.id}`
    : "/lead/coordinators";

  return (
    <PageFrame
      title={"reassignment" in result ? `Reassign ${result.reassignment.event.name}` : "Reassign a coordinator"}
      description="Choose who takes over this event. Clashes are shown so you can choose with the dates in mind."
      action={
        <Link className={buttonVariants({ variant: "outline" })} href={back}>
          <ArrowLeft aria-hidden="true" />
          Back
        </Link>
      }
      error={"error" in result ? result.error : undefined}
    >
      {"reassignment" in result && (
        <>
          <LeadEventSummary
            event={result.reassignment.event}
            coordinator={result.reassignment.current ? (result.reassignment.current.full_name ?? "Unnamed coordinator") : undefined}
          />
          {result.reassignment.canReassign && result.reassignment.current ? (
            <LeadAssignForm
              mode="reassign"
              eventId={id}
              eventName={result.reassignment.event.name}
              coordinators={result.reassignment.coordinators}
              currentName={result.reassignment.current.full_name ?? undefined}
              cancelHref={back}
            />
          ) : (
            // SCRUM-79/AC5 (closed) and AC1 (nobody to reassign from): no reassign action
            <p role="status" className="flex items-start gap-2 rounded-lg border border-status-info-fg bg-status-info p-4 text-sm text-status-info-fg">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {isClosedEventStatus(result.reassignment.event.status)
                ? "This event is closed, so its coordinator can't be changed."
                : "This event has no coordinator yet. Assign one from the unassigned queue."}
            </p>
          )}
        </>
      )}
    </PageFrame>
  );
}
