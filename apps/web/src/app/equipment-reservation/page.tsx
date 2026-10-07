import type { Metadata } from "next";
import Link from "next/link";
import { EquipmentReservationForm } from "@/components/EquipmentReservationForm";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getReservationFormData } from "@/lib/equipmentReservationServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reserve equipment · ConnectSphere" };

// SCRUM-19: Technical Support Staff reserve available equipment for an event.
export default async function EquipmentReservationPage() {
  const result = await getReservationFormData();

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        <h1>Reserve equipment</h1>
        {"events" in result ? (
          <EquipmentReservationForm events={result.events} equipment={result.equipment} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
