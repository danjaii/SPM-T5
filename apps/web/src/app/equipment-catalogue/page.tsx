import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthAlert } from "@/components/auth/AuthParts";
import { EquipmentCatalogueManager } from "@/components/equipment/EquipmentCatalogueManager";
import { canManageCatalogue, getEquipmentCatalogue } from "@/lib/equipmentCatalogueServer";

// Rendered per request: who may manage the catalogue depends on who is signed in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Equipment catalogue · ConnectSphere" };

// SCRUM-182: Technical Support Staff add equipment, edit it and change its operational status. Anyone else who opens the address is
// sent to the access-denied page by the route guard, and is told why here too (182-S5); the service and the database refuse them as
// well.
export default async function EquipmentCataloguePage() {
  const allowed = await canManageCatalogue();
  const loaded = allowed ? await getEquipmentCatalogue() : undefined;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8 md:px-8">
      <Link
        href="/equipment-inventory"
        className="flex w-fit items-center gap-1.5 text-sm font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to inventory
      </Link>
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Equipment catalogue</h1>
      {!allowed ? (
        <AuthAlert tone="error">Only technical support staff can manage the equipment catalogue.</AuthAlert>
      ) : loaded && "items" in loaded ? (
        <>
          <p className="text-sm text-muted-foreground">
            Add equipment, change its details, or mark it damaged, under maintenance or retired. An item that is not Available is not
            offered by the inventory, the availability check or a new reservation.
          </p>
          <EquipmentCatalogueManager initial={loaded.items} />
        </>
      ) : (
        <AuthAlert tone="error">{loaded && "error" in loaded ? loaded.error : "Something went wrong. Please try again."}</AuthAlert>
      )}
    </main>
  );
}
