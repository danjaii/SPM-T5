import type { Metadata } from "next";
import { AuthAlert } from "@/components/auth/AuthParts";
import { EquipmentCatalogueManager } from "@/components/equipment/EquipmentCatalogueManager";
import { canManageCatalogue, getEquipmentCatalogue } from "@/lib/equipmentCatalogueServer";
import { BackLink, PAGE_MAIN, PageTitle } from "@/components/PageFrame";

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
    <main className={PAGE_MAIN}>
      <BackLink href="/equipment-inventory" to="inventory" />
      <PageTitle>Equipment catalogue</PageTitle>
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
