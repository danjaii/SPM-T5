import type { Metadata } from "next";
import { EventRequestForm } from "@/components/event-request/EventRequestForm";
import { PageFrame } from "@/components/PageFrame";
import { draftToValues } from "@/lib/eventRequestForm";
import { getDraftForEdit, getRequestOptions } from "@/lib/eventRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "New event request · ConnectSphere" };

// SCRUM-123: the Event Organiser's step-by-step request form. event-service (SCRUM-49) refuses anyone else.
// SCRUM-186/AC1, AC5: the shared page frame.
export default async function NewEventRequestPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  // SCRUM-54/AC1: ?draft=<id> reopens a saved draft in the same form
  const { draft: draftId } = await searchParams;
  const options = await getRequestOptions();
  const opened = draftId ? await getDraftForEdit(draftId) : undefined;
  const draft = opened && "draft" in opened ? opened.draft : undefined;
  return (
    <PageFrame
      title="New event request"
      error={opened && "error" in opened ? opened.error : "roomLayouts" in options ? undefined : options.error}
    >
      {"roomLayouts" in options && (
        <EventRequestForm
          key={draft?.id ?? "new"}
          layouts={options.roomLayouts}
          draft={draft ? { id: draft.id, values: draftToValues(draft) } : undefined}
        />
      )}
    </PageFrame>
  );
}
