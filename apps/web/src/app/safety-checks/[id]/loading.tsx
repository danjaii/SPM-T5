import { Skeleton } from "@/components/ui/skeleton";

// SCRUM-142/AC11: shown while a safety check loads.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8" role="status" aria-label="Loading safety check">
      <Skeleton className="mb-6 h-9 w-80 max-w-full" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </main>
  );
}
