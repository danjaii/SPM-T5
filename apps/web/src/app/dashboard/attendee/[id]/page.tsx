import type { Metadata } from "next";
import { EventDetails } from "@/components/EventDetails";
import { BackLink, PageFrame } from "@/components/PageFrame";
import { getRegistrationForm } from "@/lib/eventRegistrationServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event details · ConnectSphere" };

// SCRUM-139: an attendee opens an event from Browse events or My registrations to read more. event-service's registration-form
// endpoint already sends the event as its card shows it, with the attendee's own status, so no new endpoint is needed.
// Inside PageFrame, so the width and spacing match My registrations.
export default async function AttendeeEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getRegistrationForm(id);

  return (
    <PageFrame
      title="Event details"
      description="Everything you need to know before you register."
      error={"error" in result ? result.error : undefined}
    >
      <BackLink href="/dashboard/attendee/browse" to="events" />
      {"data" in result && <EventDetails event={result.data.event} />}
    </PageFrame>
  );
}
