import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// SCRUM-129/AC10: the shape of the venue detail card while it loads.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8" aria-busy="true" aria-label="Loading the venue">
      <Card className="gap-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
        <Skeleton className="h-24 w-full" />
      </Card>
    </main>
  );
}
