import type { Metadata } from "next";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { utcToSgt } from "@spm-t5/shared";
import { buttonVariants } from "@/components/ui/button";
import { AuthAlert } from "@/components/auth/AuthParts";
import { PageFrame } from "@/components/PageFrame";
import { InventoryPeriodForm } from "@/components/equipment/InventoryPeriodForm";
import { InventoryTable } from "@/components/equipment/InventoryTable";
import type { InventoryPeriodQuery } from "@/lib/equipmentInventory";
import { getEquipmentInventory } from "@/lib/equipmentInventoryServer";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Inventory · ConnectSphere" };

type SearchParams = Record<string, string | string[] | undefined>;

/** The period from the address; anything missing starts on today, 07:00 to 23:00 Singapore time, like SCRUM-18's form. */
function periodFrom(query: SearchParams): InventoryPeriodQuery {
  const text = (value: string | string[] | undefined, fallback: string) => (typeof value === "string" ? value : fallback);
  return {
    date: text(query.date, utcToSgt(new Date()).date),
    startTime: text(query.startTime, "07:00"),
    endTime: text(query.endTime, "23:00"),
  };
}

// SCRUM-137/AC2: Technical Support Staff see every item's free, working units for a period, and why the rest are not.
// SCRUM-186/AC2: a sidebar page, so no back link.
export default async function EquipmentInventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const period = periodFrom(await searchParams);
  const result = await getEquipmentInventory(period);

  return (
    <PageFrame
      title="Inventory"
      description="Only working units that no other event holds at that time count as free."
      action={
        // SCRUM-182: this page is Technical Support Staff's own (route guard), so the catalogue is offered to them only.
        <Link href="/equipment-catalogue" className={cn(buttonVariants({ variant: "outline" }))}>
          <Settings2 aria-hidden="true" />
          Manage catalogue
        </Link>
      }
    >

      <InventoryPeriodForm period={period} fieldErrors={"fieldErrors" in result ? result.fieldErrors : undefined} />

      {"items" in result && <InventoryTable items={result.items} />}
      {"error" in result && <AuthAlert tone="error">{result.error}</AuthAlert>}
    </PageFrame>
  );
}
