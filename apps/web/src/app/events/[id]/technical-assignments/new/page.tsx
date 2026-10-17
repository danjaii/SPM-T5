import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { TechnicalAssignmentForm } from "@/components/TechnicalAssignmentForm";
import { getTechnicalAssignmentForm } from "@/lib/technicalAssignmentsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Assign technical support · ConnectSphere" };

// SCRUM-20/AC1: the event's coordinator assigns a technician on-site. Anyone else gets equipment-service's refusal.
export default async function NewTechnicalAssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTechnicalAssignmentForm(id);

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href={`/events/${id}`}>← Back to event</Link>
        {"data" in result ? (
          <TechnicalAssignmentForm eventId={id} data={result.data} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
