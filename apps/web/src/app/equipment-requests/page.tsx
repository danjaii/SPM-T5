import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { EquipmentQueueList } from "@/components/EquipmentQueueList";
import { Badge } from "@/components/ui/badge";
import { getEquipmentQueue } from "@/lib/equipmentRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Equipment requests · ConnectSphere" };

// SCRUM-87: Technical Support Staff see the equipment requests waiting for them, soonest event first.
// AC7: anyone else gets equipment-service's refusal instead of the list.
// SCRUM-136/AC2 (Figma frame 11): inside the shared app shell, with the count of what is waiting and the event the address
// names (`?event=`) open beside the list.
export default async function EquipmentQueuePage({ searchParams }: { searchParams?: Promise<{ event?: string }> }) {
  const [result, query] = await Promise.all([getEquipmentQueue(), searchParams]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Equipment requests</h1>
        {"requests" in result && <Badge variant="info">{result.requests.length} pending</Badge>}
      </div>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Requests from coordinators, soonest event first. Choose an event to review its items.
      </p>
      {"requests" in result
        ? <EquipmentQueueList requests={result.requests} selectedEventId={query?.event} />
        : <AuthAlert tone="error">{result.error}</AuthAlert>}
    </main>
  );
}
