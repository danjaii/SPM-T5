import type { Metadata } from "next";
import Link from "next/link";
import { isClosedEventStatus } from "@spm-t5/shared";
import EventStatusBadge from "@/components/EventStatusBadge";
import { EventRequestDetails } from "@/components/EventRequestDetails";
import { PageFrame } from "@/components/PageFrame";
import { buttonVariants } from "@/components/ui/button";
import { getEvent } from "@/lib/getEvent";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Event details · ConnectSphere" };

// SCRUM-126: the Lead opens an event from the queue to read its request before choosing a coordinator, and can go on to
// assign or reassign it. event-service decides what the Lead may read (the unassigned requests and their own team's events).
export default async function LeadEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEvent(id);

  if (!("event" in result)) {
    return <PageFrame title="Event details" description="The request as the organiser submitted it." error={result.error} />;
  }

  const { event } = result;
  const open = !isClosedEventStatus(event.status);
  const coordinator = event.point_of_contact_name;

  return (
    <PageFrame
      title={event.name}
      description="The request as the organiser submitted it."
      action={
        open && (
          <Link className={buttonVariants()} href={`/lead/events/${id}/${coordinator ? "reassign" : "assign"}`}>
            {coordinator ? "Reassign coordinator" : "Assign coordinator"}
          </Link>
        )
      }
    >
      <p className="flex flex-wrap items-center gap-3 text-sm">
        <EventStatusBadge status={event.status} />
        <span>{coordinator ? `Coordinator: ${coordinator}` : "No coordinator assigned yet"}</span>
      </p>
      <EventRequestDetails event={event} />
    </PageFrame>
  );
}
