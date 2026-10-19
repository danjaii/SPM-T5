import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { EquipmentQueueList } from "@/components/EquipmentQueueList";
import { getEquipmentQueue } from "@/lib/equipmentRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Equipment requests · ConnectSphere" };

// SCRUM-87: Technical Support Staff see the equipment requests waiting for them, soonest event first.
// AC7: anyone else gets equipment-service's refusal instead of the list.
export default async function EquipmentQueuePage() {
  const result = await getEquipmentQueue();

  return (
    <>
      <AppHeader />
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        <h1>Equipment requests</h1>
        {"requests" in result ? (
          <EquipmentQueueList requests={result.requests} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
