import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { EventDetailsForm } from "@/components/EventDetailsForm";
import { getEventEditForm } from "@/lib/getEvent";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit event details · ConnectSphere" };

// SCRUM-111: the assigned coordinator edits an event's planning information. event-service refuses anyone else, or a
// finished event, and its message is shown instead of the form.
export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEventEditForm(id);

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href={`/events/${id}`}>← Back to event</Link>
        {"form" in result ? (
          <EventDetailsForm eventId={id} form={result.form} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
