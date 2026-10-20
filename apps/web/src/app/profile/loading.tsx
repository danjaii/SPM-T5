import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// SCRUM-122/AC10: the shape of the profile page while it loads, so nothing jumps when it arrives.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-8" aria-busy="true" aria-label="Loading your profile">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">My profile</h1>
      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  );
}
