import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { EventRegistrationForm } from "@/components/EventRegistrationForm";
import { getRegistrationForm } from "@/lib/eventRegistrationServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Register for an event · ConnectSphere" };

// SCRUM-83: an attendee registers for an upcoming event (from Register on its List of events card)
export default async function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getRegistrationForm(id);

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/dashboard/attendee">← Back to events</Link>
        {"data" in result ? (
          <EventRegistrationForm data={result.data} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
