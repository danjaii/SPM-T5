import type { Metadata } from "next";
import { EquipmentAvailabilityForm } from "@/components/EquipmentAvailabilityForm";
import { PageFrame } from "@/components/PageFrame";
import { getEquipmentOptions } from "@/lib/equipmentAvailabilityServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Equipment availability · ConnectSphere" };

// SCRUM-18: Technical Support Staff check whether enough units of a piece of equipment are free.
// SCRUM-186/AC2, AC4: a sidebar page, so no back link, and titled as the sidebar names it.
export default async function EquipmentAvailabilityPage() {
  const result = await getEquipmentOptions();

  return (
    <PageFrame title="Equipment availability" error={"equipment" in result ? undefined : result.error}>
      {"equipment" in result && <EquipmentAvailabilityForm equipment={result.equipment} />}
    </PageFrame>
  );
}
