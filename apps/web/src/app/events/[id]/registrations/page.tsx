import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { EventRegistrationList } from "@/components/EventRegistrationList";
import { getEventRegistrations } from "@/lib/eventRegistrationServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Registrations · ConnectSphere" };

// SCRUM-83/AC15: the registration information page seen by the event's organiser and assigned coordinator.
// Who sees which rows is RLS's job (supabase/migrations/11_event_registrations.sql).
export default async function EventRegistrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEventRegistrations(id);

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href={`/events/${id}`}>← Back to event</Link>
        <h1>Registrations</h1>
        {"registrations" in result ? (
          <EventRegistrationList registrations={result.registrations} />
        ) : (
          // Couldn't load: say so, rather than "Nobody has registered for this event yet."
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
