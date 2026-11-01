import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WeekItem } from "@/lib/coordinatorDashboard";
import { EVENT_STATUS_DISPLAY } from "@/lib/status";

/**
 * SCRUM-160 (Figma 16): "This week", the coordinator's open events that start between Monday and Sunday, each with a day tile,
 * its venue and start time, and its status (icon and label). Undefined items mean the events could not be loaded.
 */
export function CoordinatorThisWeek({ items }: { items?: WeekItem[] }) {
  return (
    <section aria-labelledby="this-week" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="px-5 py-4">
        <h2 id="this-week" className="font-heading text-xl font-bold">This week</h2>
      </div>
      <div className="px-5 pb-5">
        {items === undefined ? (
          <p className="flex items-center gap-2 text-base font-medium text-status-warning-fg">
            <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
            Unavailable
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events start this week.</p>
        ) : (
          <ul className="space-y-4">
            {items.map((i) => (
              <li key={i.id}>
                <Link href={`/events/${i.id}`} aria-label={`Open ${i.name}`} className="flex items-center gap-3 rounded-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-muted py-1.5 leading-tight" aria-hidden="true">
                    <span className="text-xs text-muted-foreground">{i.weekday}</span>
                    <span className="font-heading text-xl font-bold">{i.day}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{i.name}</span>
                    <span className="block text-xs text-muted-foreground">{i.detail}</span>
                  </span>
                  <StatusBadge {...EVENT_STATUS_DISPLAY[i.status]} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
