import { EventReview } from "@/components/EventReview";

export default async function EventRequestAccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventReview requestId={id} />;
}
