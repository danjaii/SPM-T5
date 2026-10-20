import type { Metadata } from "next";
import Link from "next/link";
import { isClosedEventStatus } from "@spm-t5/shared";
import { LeadAssignForm } from "@/components/LeadAssignForm";
import { LeadEventSummary } from "@/components/LeadEventSummary";
import { getLeadAssignment } from "@/lib/leadServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Assign a coordinator · ConnectSphere" };

// SCRUM-78: the Lead assigns an unassigned event request to one of their coordinators, opened from the queue.
export default async function LeadAssignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getLeadAssignment(id);

  return (
    <>
      <main className="dash__main">
        <Link className="back-link" href="/lead/queue">← Back to unassigned event requests</Link>
        {"assignment" in result ? (
          <>
            <h1>Assign a coordinator to {result.assignment.event.name}</h1>
            <LeadEventSummary event={result.assignment.event} />
            {result.assignment.canAssign ? (
              <LeadAssignForm eventId={id} eventName={result.assignment.event.name} coordinators={result.assignment.coordinators} />
            ) : (
              // SCRUM-78/AC6 (closed) and AC3 (already assigned): no assign action
              <p className="alert alert--info">
                {isClosedEventStatus(result.assignment.event.status)
                  ? "This event is closed, so a coordinator can't be assigned."
                  : "This event already has a coordinator."}
              </p>
            )}
          </>
        ) : (
          <>
            <h1>Assign a coordinator</h1>
            <div className="alert alert--error" role="alert">{result.error}</div>
          </>
        )}
      </main>
    </>
  );
}
