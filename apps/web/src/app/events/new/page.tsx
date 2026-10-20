import type { Metadata } from "next";
import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { getRequestOptions } from "@/lib/eventRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New event request · ConnectSphere" };

// SCRUM-123: the Event Organiser's step-by-step request form. event-service (SCRUM-49) refuses anyone else.
export default async function NewEventRequestPage() {
  const options = await getRequestOptions();
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="font-heading text-3xl font-bold text-foreground">New event request</h1>
      {"roomLayouts" in options ? (
        <EventRequestForm layouts={options.roomLayouts} />
      ) : (
        <p role="alert" className="rounded-lg bg-status-danger p-4 text-sm font-medium text-status-danger-fg">{options.error}</p>
      )}
    </main>
  );
}
