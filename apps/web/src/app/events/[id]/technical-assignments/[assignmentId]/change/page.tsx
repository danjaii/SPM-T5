import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { TechnicalAssignmentForm } from "@/components/TechnicalAssignmentForm";
import { getTechnicalAssignmentForm } from "@/lib/technicalAssignmentsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Change on-site assignment · ConnectSphere" };

// SCRUM-20/AC2: the event's coordinator changes an assignment's venue booking, times or note; the technician is told.
export default async function ChangeTechnicalAssignmentPage({
  params,
}: {
  params: Promise<{ id: string; assignmentId: string }>;
}) {
  const { id, assignmentId } = await params;
  const result = await getTechnicalAssignmentForm(id);
  const assignment = "data" in result ? result.data.assignments.find((a) => a.id === assignmentId) : undefined;

  let content;
  if (!("data" in result)) content = <div className="alert alert--error" role="alert">{result.error}</div>;
  else if (!assignment || assignment.status === "CANCELLED")
    content = <div className="alert alert--error" role="alert">This assignment can&apos;t be changed.</div>;
  else content = <TechnicalAssignmentForm eventId={id} data={result.data} assignment={assignment} />;

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href={`/events/${id}`}>← Back to event</Link>
        {content}
      </main>
    </>
  );
}
