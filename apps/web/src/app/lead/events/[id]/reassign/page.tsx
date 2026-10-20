import type { Metadata } from "next";
import Link from "next/link";
import { isClosedEventStatus } from "@spm-t5/shared";
import { LeadAssignForm } from "@/components/LeadAssignForm";
import { LeadEventSummary } from "@/components/LeadEventSummary";
import { getLeadReassignment } from "@/lib/leadServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reassign a coordinator · ConnectSphere" };

// SCRUM-79: the Lead hands an event held by one of their coordinators to another, opened from that coordinator's events.
export default async function LeadReassignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getLeadReassignment(id);
  const back = "reassignment" in result && result.reassignment.current
    ? `/lead/coordinators/${result.reassignment.current.id}`
    : "/lead/coordinators";

  return (
    <>
      <main className="dash__main">
        <Link className="back-link" href={back}>← Back</Link>
        {"reassignment" in result ? (
          <>
            <h1>Reassign {result.reassignment.event.name}</h1>
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
              <p className="alert alert--info">
                {isClosedEventStatus(result.reassignment.event.status)
                  ? "This event is closed, so its coordinator can't be changed."
                  : "This event has no coordinator yet. Assign one from the unassigned queue."}
              </p>
            )}
          </>
        ) : (
          <>
            <h1>Reassign a coordinator</h1>
            <div className="alert alert--error" role="alert">{result.error}</div>
          </>
        )}
      </main>
    </>
  );
}
