import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE_MAIN, PageTitle } from "@/components/PageFrame";

// SCRUM-134/AC10: the shape of the booking queue while it loads.
export default function Loading() {
  return (
    <main className={PAGE_MAIN} aria-busy="true" aria-label="Loading the booking requests">
      <PageTitle>Booking requests</PageTitle>
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="px-4">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </Card>
        ))}
      </div>
    </main>
  );
}
