import type { Metadata } from "next";
import Link from "next/link";
import { EventDetails } from "@/components/EventDetails";
import { PageFrame } from "@/components/PageFrame";
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
      <Link className="text-sm font-medium text-primary underline-offset-4 hover:underline" href="/dashboard/attendee">← Back to events</Link>
      {"data" in result && <EventDetails event={result.data.event} />}
    </PageFrame>
  );
}
