import { ArrowLeft, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// SCRUM-186/AC1: the one width and padding every signed-in page uses, so content never jumps in width between pages.
export const PAGE_MAIN = "mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6";

// SCRUM-186/AC5: the one page title style.
export function PageTitle({ id, className, children }: { id?: string; className?: string; children: ReactNode }) {
  return <h1 id={id} className={cn("font-heading text-2xl font-bold break-words text-foreground", className)}>{children}</h1>;
}

// SCRUM-186/AC3: the one back link, for pages reached from inside the app. Sidebar pages have none (AC2).
export function BackLink({ href, to }: { href: string; /** Where it goes, as in "Back to <to>". */ to: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to {to}
    </Link>
  );
}

// SCRUM-126/AC5, AC11: the title, subtitle and error state the Lead pages share; SCRUM-139 reuses it for the attendee and
// registration pages, and SCRUM-186 for every signed-in page. The sidebar comes from the app shell.
export function PageFrame({
  title,
  description,
  back,
  badge,
  action,
  error,
  children,
}: {
  title: string;
  description?: string;
  /** Only for pages that are not in the sidebar (SCRUM-186/AC2, AC3). */
  back?: { href: string; to: string };
  /** Shown beside the title, such as a count of what is waiting. */
  badge?: ReactNode;
  /** A button at the right of the title (Figma 04's "View all active events"). */
  action?: ReactNode;
  error?: string;
  children?: ReactNode;
}) {
  return (
    <main className={PAGE_MAIN}>
      {back && <BackLink href={back.href} to={back.to} />}
      {/* a div, not <header>: the page title is not a site banner, and the shell's sidebar is the only top-level chrome */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <PageTitle>{title}</PageTitle>
            {badge}
          </div>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
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

/** SCRUM-126/AC11: shown while a page loads. */
export function PageFrameSkeleton({ label }: { label: string }) {
  return (
    <main className={PAGE_MAIN} role="status" aria-label={label}>
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
