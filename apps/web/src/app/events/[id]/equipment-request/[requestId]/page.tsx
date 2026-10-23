import { redirect } from "next/navigation";

// SCRUM-88 changed a request on this page; SCRUM-136/AC1 changes it in its row on the event's Equipment tab, so an older
// link opens that tab.
export default async function ChangeEquipmentRequestPage({ params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id } = await params;
  redirect(`/events/${encodeURIComponent(id)}?tab=equipment`);
}
