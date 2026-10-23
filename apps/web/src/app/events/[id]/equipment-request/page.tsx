import { redirect } from "next/navigation";

// SCRUM-86 asked for equipment on this page; SCRUM-136/AC1 moved it to a row on the event's Equipment tab, so an older
// link opens that tab.
export default async function EquipmentRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/events/${encodeURIComponent(id)}?tab=equipment`);
}
