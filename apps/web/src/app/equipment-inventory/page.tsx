import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { utcToSgt } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { InventoryPeriodForm } from "@/components/equipment/InventoryPeriodForm";
import { InventoryTable } from "@/components/equipment/InventoryTable";
import type { InventoryPeriodQuery } from "@/lib/equipmentInventory";
import { getEquipmentInventory } from "@/lib/equipmentInventoryServer";

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
export default async function EquipmentInventoryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const period = periodFrom(await searchParams);
  const result = await getEquipmentInventory(period);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/dashboard"
          className="mb-2 inline-flex items-center gap-1 self-start text-sm font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> Back to dashboard
        </Link>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Inventory</h1>
        <p className="text-sm text-muted-foreground">
          Only working units that no other event holds at that time count as free.
        </p>
      </div>

      <InventoryPeriodForm period={period} fieldErrors={"fieldErrors" in result ? result.fieldErrors : undefined} />

      {"items" in result && <InventoryTable items={result.items} />}
      {"error" in result && <AuthAlert tone="error">{result.error}</AuthAlert>}
    </main>
  );
}
