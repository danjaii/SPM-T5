import { Skeleton } from "@/components/ui/skeleton";

// SCRUM-138/AC9: the shape of the page while it loads: the event cards on the left, the equipment card on the right.
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8" aria-busy="true" aria-label="Loading the reservation page">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Reserve equipment</h1>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    </main>
  );
}
