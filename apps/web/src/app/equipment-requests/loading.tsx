import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// SCRUM-136/AC10: the shape of the equipment queue while it loads: event cards beside the open event's items.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8" aria-busy="true" aria-label="Loading the equipment requests">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Equipment requests</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Card key={i} className="px-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-28" />
            </Card>
          ))}
        </div>
        <Card className="gap-3 p-6 lg:col-span-2">
          <Skeleton className="h-6 w-56" />
          {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-8 w-full" />)}
        </Card>
      </div>
    </main>
  );
}
