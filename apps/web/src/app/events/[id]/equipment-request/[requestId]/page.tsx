import type { Metadata } from "next";
import Link from "next/link";
import { EquipmentRequestForm } from "@/components/EquipmentRequestForm";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getEquipmentRequestEditForm } from "@/lib/equipmentRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Change equipment request · ConnectSphere" };

// SCRUM-88: the assigned coordinator changes one of the event's equipment requests. AC4, AC6 and Released requests:
// anyone else, a finished event, or Released equipment gets equipment-service's refusal instead of the form.
export default async function ChangeEquipmentRequestPage({ params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await params;
  const result = await getEquipmentRequestEditForm(id, requestId);

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href={`/events/${id}`}>← Back to event</Link>
        {"form" in result ? (
          <EquipmentRequestForm form={result.form} existing={result.form.request} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
