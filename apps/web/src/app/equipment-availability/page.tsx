import type { Metadata } from "next";
import Link from "next/link";
import { EquipmentAvailabilityForm } from "@/components/EquipmentAvailabilityForm";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { getEquipmentOptions } from "@/lib/equipmentAvailabilityServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Check equipment availability · ConnectSphere" };

// SCRUM-18: Technical Support Staff check whether enough units of a piece of equipment are free.
export default async function EquipmentAvailabilityPage() {
  const result = await getEquipmentOptions();

  return (
    <>
      <header className="dash__bar">
        <Logo />
        <LogoutButton />
      </header>
      <main className="dash__main">
        <Link className="back-link" href="/dashboard">← Back to dashboard</Link>
        <h1>Check equipment availability</h1>
        {"equipment" in result ? (
          <EquipmentAvailabilityForm equipment={result.equipment} />
        ) : (
          <div className="alert alert--error" role="alert">{result.error}</div>
        )}
      </main>
    </>
  );
}
