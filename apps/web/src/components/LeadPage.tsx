import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// SCRUM-126/AC5, AC11: the title, subtitle and error state the Lead's pages share. The sidebar comes from the app shell.
export function LeadPage({
  title,
  description,
  action,
  error,
  children,
}: {
  title: string;
  description: string;
  /** A button at the right of the title (Figma 04's "View all active events"). */
  action?: ReactNode;
  error?: string;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </header>
      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-status-danger-fg bg-status-danger p-4 text-sm text-status-danger-fg">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      ) : (
        children
      )}
    </main>
  );
}

/** SCRUM-126/AC11: shown while a Lead page loads. */
export function LeadPageSkeleton({ label }: { label: string }) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6" role="status" aria-label={label}>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </main>
  );
}
