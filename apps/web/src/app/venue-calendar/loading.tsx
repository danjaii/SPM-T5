import { Skeleton } from "@/components/ui/skeleton";

// SCRUM-84/AC1: the shape of the page while it loads.
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 md:px-8" aria-busy="true" aria-label="Loading the venue calendar">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">Venue calendar</h1>
      {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 w-full" />)}
    </main>
  );
}
