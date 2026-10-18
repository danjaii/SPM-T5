import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { EquipmentAvailabilityForm } from "@/components/EquipmentAvailabilityForm";
import { getEquipmentOptions } from "@/lib/equipmentAvailabilityServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Check equipment availability · ConnectSphere" };

// SCRUM-18: Technical Support Staff check whether enough units of a piece of equipment are free.
export default async function EquipmentAvailabilityPage() {
  const result = await getEquipmentOptions();

  return (
    <>
      <AppHeader />
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
