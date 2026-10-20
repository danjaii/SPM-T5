import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { EventDetailsForm } from "@/components/EventDetailsForm";
import { InlineMessage } from "@/components/event/InlineMessage";
import { getEventEditForm } from "@/lib/getEvent";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit event details · ConnectSphere" };

// SCRUM-111: the assigned coordinator edits an event's planning information. event-service refuses anyone else, or a
// finished event, and its message is shown instead of the form. SCRUM-128: laid out like the event page.
export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEventEditForm(id);

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="mb-4 inline-block text-sm font-medium text-fg-primary hover:underline" href={`/events/${id}`}>← Back to event</Link>
        {"form" in result ? (
          <EventDetailsForm eventId={id} form={result.form} />
        ) : (
          <InlineMessage kind="error">{result.error}</InlineMessage>
        )}
      </main>
    </>
  );
}
