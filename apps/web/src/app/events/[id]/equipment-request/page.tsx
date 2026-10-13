import type { Metadata } from "next";
import Link from "next/link";
import { EquipmentRequestForm } from "@/components/EquipmentRequestForm";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getEquipmentRequestForm } from "@/lib/equipmentRequestsServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Request equipment · ConnectSphere" };

// SCRUM-86: the assigned coordinator requests equipment for their event. AC6, AC7: anyone else, or a finished event,
// gets equipment-service's refusal instead of the form.
export default async function EquipmentRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getEquipmentRequestForm(id);

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href={`/events/${id}`}>← Back to event</Link>
        {"form" in result ? (
          <EquipmentRequestForm form={result.form} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
