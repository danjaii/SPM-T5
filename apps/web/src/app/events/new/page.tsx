import type { Metadata } from "next";
import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { draftToValues, lastEditedStep } from "@/lib/eventRequestForm";
import { getDraftForEdit, getRequestOptions } from "@/lib/eventRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New event request · ConnectSphere" };

// SCRUM-124/AC3: the draft's boxes and the step it resumes at
function resume(draft: Parameters<typeof draftToValues>[0] & { id: string }) {
  const values = draftToValues(draft);
  return { id: draft.id, values, step: lastEditedStep(values) };
}

// SCRUM-123: the Event Organiser's step-by-step request form. event-service (SCRUM-49) refuses anyone else.
export default async function NewEventRequestPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  // SCRUM-54/AC1: ?draft=<id> reopens a saved draft in the same form
  const { draft: draftId } = await searchParams;
  const options = await getRequestOptions();
  const opened = draftId ? await getDraftForEdit(draftId) : undefined;
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <h1 className="font-heading text-3xl font-bold text-foreground">New event request</h1>
      {opened && "error" in opened ? (
        <p role="alert" className="rounded-lg bg-status-danger p-4 text-sm font-medium text-status-danger-fg">{opened.error}</p>
      ) : "roomLayouts" in options ? (
        <EventRequestForm
          key={opened?.draft.id ?? "new"}
          layouts={options.roomLayouts}
          draft={opened ? resume(opened.draft) : undefined}
        />
      ) : (
        <p role="alert" className="rounded-lg bg-status-danger p-4 text-sm font-medium text-status-danger-fg">{options.error}</p>
      )}
    </main>
  );
}
