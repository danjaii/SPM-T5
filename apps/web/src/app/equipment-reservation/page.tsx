import type { Metadata } from "next";
import { EquipmentReservationForm } from "@/components/EquipmentReservationForm";
import { PageFrame } from "@/components/PageFrame";
import { getReservationFormData } from "@/lib/equipmentReservationServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reserve equipment · ConnectSphere" };

// SCRUM-19: Technical Support Staff reserve available equipment for an event.
// SCRUM-138: inside the shared app shell (no header or back link of its own), laid out like Figma frame 11.
// SCRUM-186/AC1, AC5: the shared page frame.
export default async function EquipmentReservationPage() {
  const result = await getReservationFormData();

  return (
    <PageFrame
      title="Reserve equipment"
      description="Pick an event, choose the equipment and a quantity, and the units are held for that event and its times."
      error={"events" in result ? undefined : result.error}
    >
      {"events" in result && <EquipmentReservationForm events={result.events} equipment={result.equipment} />}
    </PageFrame>
  );
}
