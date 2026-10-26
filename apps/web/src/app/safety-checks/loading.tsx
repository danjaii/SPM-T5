import { Skeleton } from "@/components/ui/skeleton";

// SCRUM-142/AC11: shown while the queue loads.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8" role="status" aria-label="Loading events waiting for a safety check">
      <Skeleton className="mb-6 h-9 w-96 max-w-full" />
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    </main>
  );
}
