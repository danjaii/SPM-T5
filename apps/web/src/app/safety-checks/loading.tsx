import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_MAIN } from "@/components/PageFrame";

// SCRUM-142/AC11: shown while the queue loads.
export default function Loading() {
  return (
    <main className={PAGE_MAIN} role="status" aria-label="Loading safety checks">
      <Skeleton className="mb-6 h-9 w-96 max-w-full" />
      <div className="space-y-3">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    </main>
  );
}
