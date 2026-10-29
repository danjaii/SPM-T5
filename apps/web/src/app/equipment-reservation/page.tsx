import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { EquipmentReservationForm } from "@/components/EquipmentReservationForm";
import { getReservationFormData } from "@/lib/equipmentReservationServer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Reserve equipment · ConnectSphere" };

// SCRUM-19: Technical Support Staff reserve available equipment for an event.
// SCRUM-138: inside the shared app shell (no header or back link of its own), laid out like Figma frame 11.
export default async function EquipmentReservationPage() {
  const result = await getReservationFormData();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Reserve equipment</h1>
        <p className="text-sm text-muted-foreground">
          Pick an event, choose the equipment and a quantity, and the units are held for that event and its times.
        </p>
      </div>
      {"events" in result ? (
        <EquipmentReservationForm events={result.events} equipment={result.equipment} />
      ) : (
        <AuthAlert tone="error">{result.error}</AuthAlert>
      )}
    </main>
  );
}
