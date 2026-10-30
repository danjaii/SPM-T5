import type { Metadata } from "next";
import Link from "next/link";
import { EventRegistrationList } from "@/components/EventRegistrationList";
import { PageFrame } from "@/components/PageFrame";
import { getEventRegistrations } from "@/lib/eventRegistrationServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Registrations · ConnectSphere" };

// SCRUM-83/AC15: the registration information page seen by the event's organiser and assigned coordinator.
// Who sees which rows is RLS's job (supabase/migrations/11_event_registrations.sql).
// SCRUM-139/AC4, AC5, AC11: inside the shared shell, with an error state.
export default async function EventRegistrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEventRegistrations(id);

  return (
    <PageFrame
      title="Registrations"
      description="Everyone who has registered for this event."
      action={<Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href={`/events/${id}`}>← Back to event</Link>}
      // Couldn't load: say so, rather than "Nobody has registered for this event yet."
      error={"error" in result ? result.error : undefined}
    >
      {"registrations" in result && <EventRegistrationList registrations={result.registrations} />}
    </PageFrame>
  );
}
