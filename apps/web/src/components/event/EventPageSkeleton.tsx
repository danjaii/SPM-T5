import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import EventStatusBadge from "@/components/EventStatusBadge";
import { StatusStepper } from "@/components/event/StatusStepper";
import { cn } from "@/lib/utils";

/** The tabs every event page offers (Figma frames 05, 06, 15). */
export const EVENT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "venues", label: "Venues" },
  { id: "equipment", label: "Equipment" },
  { id: "safety", label: "Safety" },
  { id: "registrations", label: "Registrations" },
  { id: "changes", label: "Changes & history" },
] as const;
export type EventTabId = (typeof EVENT_TABS)[number]["id"];

interface Props {
  name: string;
  status: string;
  hasCoordinator?: boolean;
  previousStatus?: string | null;
  /** The tab shown; each tab links to `${basePath}?tab=<id>` so a page can opt in tab by tab. */
  activeTab: EventTabId;
  basePath: string;
  /** SCRUM-121: the needs-attention banner, shown when someone has to act on this event. */
  attention?: { message: string; action?: { label: string; href: string } };
  children: ReactNode;
}

// SCRUM-121: the shared event page skeleton: header, status stepper (SCRUM-127), tabs, needs-attention banner. Pages fill the body.
export function EventPageSkeleton({ name, status, hasCoordinator = false, previousStatus, activeTab, basePath, attention, children }: Props) {
  return (
    <main className="mx-auto w-full max-w-5xl min-w-0 p-4 md:p-8">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{name}</h1>
        <EventStatusBadge status={status} />
      </header>

      {attention && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-status-warning px-4 py-3 text-status-warning-fg">
          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
          <p className="min-w-0 flex-1 text-sm font-medium">{attention.message}</p>
          {attention.action && (
            <Link href={attention.action.href} className="text-sm font-bold underline">{attention.action.label}</Link>
          )}
        </div>
      )}

      <div className="mb-6">
        <StatusStepper status={status} hasCoordinator={hasCoordinator} previousStatus={previousStatus} />
      </div>

      <nav aria-label="Event sections" className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
        {EVENT_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={`${basePath}?tab=${tab.id}`}
            aria-current={tab.id === activeTab ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm",
              tab.id === activeTab ? "border-primary font-bold text-fg-primary" : "border-transparent font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </main>
  );
}
