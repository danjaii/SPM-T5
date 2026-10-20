import Link from "next/link";
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

/** The tab a `?tab=` value names; anything else is the overview. */
export const tabFrom = (value: string | undefined): EventTabId => EVENT_TABS.find((t) => t.id === value)?.id ?? "overview";

// SCRUM-127: each tab links to `${basePath}?tab=<id>`, so the page renders one tab's content on the server.
export function EventTabs({ basePath, activeTab }: { basePath: string; activeTab: EventTabId }) {
  return (
    <nav aria-label="Event sections" className="flex gap-1 overflow-x-auto border-b border-border">
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
  );
}
