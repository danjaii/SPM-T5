import { Skeleton } from "@/components/ui/skeleton";

// SCRUM-141/AC10: shown while the Notifications page loads.
export default function Loading() {
  return (
    <main role="status" aria-label="Loading notifications" className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
      <h1 className="mb-6 text-3xl font-bold tracking-tight text-foreground">Notifications</h1>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 p-4">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
