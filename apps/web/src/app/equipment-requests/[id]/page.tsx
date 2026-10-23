import type { Metadata } from "next";
import Link from "next/link";
import { AuthAlert } from "@/components/auth/AuthParts";
import { EquipmentRequestDetail } from "@/components/EquipmentRequestDetail";
import { EquipmentRequestReview } from "@/components/EquipmentRequestReview";
import { Card } from "@/components/ui/card";
import { getEquipmentRequest } from "@/lib/equipmentRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Equipment request · ConnectSphere" };

// SCRUM-87: one equipment request, opened from the queue or by its address (AC3), and its status form (AC4, AC5).
// SCRUM-136/AC4: inside the shared app shell, laid out like the queue.
export default async function EquipmentRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEquipmentRequest(id);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 md:px-8">
      <Link className="self-start text-sm font-medium text-fg-primary hover:underline" href="/equipment-requests">← Back to equipment requests</Link>
      {"request" in result ? (
        <>
          <EquipmentRequestDetail request={result.request} />
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
