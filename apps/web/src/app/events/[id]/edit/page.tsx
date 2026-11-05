import type { Metadata } from "next";
import { EventDetailsForm } from "@/components/EventDetailsForm";
import { InlineMessage } from "@/components/event/InlineMessage";
import { getEventEditForm } from "@/lib/getEvent";
import { BackLink, PAGE_MAIN } from "@/components/PageFrame";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit event details · ConnectSphere" };

// SCRUM-111: the assigned coordinator edits an event's planning information. event-service refuses anyone else, or a
// finished event, and its message is shown instead of the form. SCRUM-128: laid out like the event page.
export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEventEditForm(id);

  return (
    <>
      <main className={PAGE_MAIN}>
        <BackLink href={`/events/${id}`} to="event" />
        {"form" in result ? (
          <EventDetailsForm eventId={id} form={result.form} />
        ) : (
          <InlineMessage kind="error">{result.error}</InlineMessage>
        )}
      </main>
    </>
  );
}
