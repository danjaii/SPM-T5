import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import EventStatusBadge from "@/components/EventStatusBadge";
import { StatusStepper } from "@/components/event/StatusStepper";
import { EVENT_TABS, EventTabs, type EventTabId } from "@/components/event/EventTabs";

export { EVENT_TABS, type EventTabId };

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
    <main className="dash__main">
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

      <EventTabs basePath={basePath} activeTab={activeTab} />


      {children}
    </main>
  );
}
