import type { Metadata } from "next";
import { EquipmentQueueList } from "@/components/EquipmentQueueList";
import { PageFrame } from "@/components/PageFrame";
import { Badge } from "@/components/ui/badge";
import { getEquipmentQueue } from "@/lib/equipmentRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Equipment requests · ConnectSphere" };

// SCRUM-87: Technical Support Staff see the equipment requests waiting for them, soonest event first.
// AC7: anyone else gets equipment-service's refusal instead of the list.
// SCRUM-136/AC2 (Figma frame 11): inside the shared app shell, with the count of what is waiting and the event the address
// names (`?event=`) open beside the list. SCRUM-186/AC1, AC5: the shared page frame.
export default async function EquipmentQueuePage({ searchParams }: { searchParams?: Promise<{ event?: string }> }) {
  const [result, query] = await Promise.all([getEquipmentQueue(), searchParams]);

  return (
    <PageFrame
      title="Equipment requests"
      description="Requests from coordinators, soonest event first. Choose an event to review its items."
      badge={"requests" in result && <Badge variant="info">{result.requests.length} pending</Badge>}
      error={"requests" in result ? undefined : result.error}
    >
      {"requests" in result && <EquipmentQueueList requests={result.requests} selectedEventId={query?.event} />}
    </PageFrame>
  );
}
