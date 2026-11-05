import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { EquipmentRequestDetail } from "@/components/EquipmentRequestDetail";
import { EquipmentRequestReview } from "@/components/EquipmentRequestReview";
import { RequestAvailability } from "@/components/equipment/RequestAvailability";
import { Card } from "@/components/ui/card";
import { getEquipmentRequest } from "@/lib/equipmentRequestsServer";
import { BackLink, PAGE_MAIN } from "@/components/PageFrame";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Equipment request · ConnectSphere" };

// SCRUM-87: one equipment request, opened from the queue or by its address (AC3), and its status form (AC4, AC5).
// SCRUM-136/AC4: inside the shared app shell, laid out like the queue.
// SCRUM-137/AC1: and whether enough units are free for it.
export default async function EquipmentRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEquipmentRequest(id);

  return (
    <main className={PAGE_MAIN}>
      <BackLink href="/equipment-requests" to="equipment requests" />
      {"request" in result ? (
        <>
          <EquipmentRequestDetail request={result.request} />
          {/* SCRUM-137/AC1: free units against what is needed, while staff still decide */}
          {result.request.availability && <RequestAvailability availability={result.request.availability} />}
          {result.request.canReview && (
            <Card className="gap-4 p-6">
              <h2 className="text-lg font-bold">Update status</h2>
              <EquipmentRequestReview request={result.request} />
            </Card>
          )}
        </>
      ) : (
        <AuthAlert tone="error">{result.error}</AuthAlert>
      )}
    </main>
  );
}
