import type { Metadata } from "next";
import { TechnicalAssignmentForm } from "@/components/TechnicalAssignmentForm";
import { getTechnicalAssignmentForm } from "@/lib/technicalAssignmentsServer";
import { BackLink, PAGE_MAIN } from "@/components/PageFrame";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Assign technical support · ConnectSphere" };

// SCRUM-20/AC1: the event's coordinator assigns a technician on-site. Anyone else gets equipment-service's refusal.
export default async function NewTechnicalAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTechnicalAssignmentForm(id);

  return (
    <>
      <main className={PAGE_MAIN}>
        <BackLink href={`/events/${id}`} to="event" />
        {"data" in result ? (
          <TechnicalAssignmentForm eventId={id} data={result.data} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
