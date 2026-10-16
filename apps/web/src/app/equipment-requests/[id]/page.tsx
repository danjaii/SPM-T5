import type { Metadata } from "next";
import Link from "next/link";
import { EquipmentRequestDetail } from "@/components/EquipmentRequestDetail";
import { EquipmentRequestReview } from "@/components/EquipmentRequestReview";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getEquipmentRequest } from "@/lib/equipmentRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Equipment request · ConnectSphere" };

// SCRUM-87: one equipment request, opened from the queue or by its address (AC3), and its status form (AC4, AC5).
export default async function EquipmentRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEquipmentRequest(id);

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/equipment-requests">← Back to equipment requests</Link>
        {"request" in result ? (
          <>
            <EquipmentRequestDetail request={result.request} />
            <EquipmentRequestReview request={result.request} />
          </>
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
