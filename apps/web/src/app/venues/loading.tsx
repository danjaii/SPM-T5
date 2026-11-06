import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_MAIN, PageTitle } from "@/components/PageFrame";

// SCRUM-129/AC10: the shape of the venue catalogue while it loads.
export default function Loading() {
  return (
    <main className={PAGE_MAIN} aria-busy="true" aria-label="Loading the venue catalogue">
      <PageTitle>Venue catalogue</PageTitle>
      <Skeleton className="mt-6 mb-4 h-10 w-full" />
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Card key={i} className="px-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </Card>
        ))}
      </div>
    </main>
  );
}
