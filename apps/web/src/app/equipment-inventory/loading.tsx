import { Skeleton } from "@/components/ui/skeleton";

// SCRUM-137/AC9: the shape of the inventory while it loads: the period form, then the table's rows.
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8" aria-busy="true" aria-label="Loading the inventory">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Inventory</h1>
      <div className="flex flex-wrap items-end gap-4">
        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-9 w-40" />)}
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    </main>
  );
}
