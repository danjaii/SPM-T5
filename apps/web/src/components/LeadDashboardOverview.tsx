import Link from "next/link";
import { ClipboardList, TriangleAlert, Users, CalendarClock, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import type { LeadCoordinator } from "@/lib/leadServer";

type Loaded<T> = T | undefined;

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number | undefined }) {
  return (
    <li>
      <Card className="h-full">
        <CardContent className="space-y-1">
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
            {label}
          </p>
          {/* a count that could not be loaded is unknown, not zero */}
          {value === undefined ? (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-status-warning-fg">
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              Unavailable
            </p>
          ) : (
            <p className="font-heading text-3xl font-bold">{value}</p>
          )}
        </CardContent>
      </Card>
    </li>
  );
}

/**
 * SCRUM-162/AC1, AC3, AC5, AC6: the Lead's overview under "Needs your action": three counts, then the busiest and least
 * busy coordinator with a link to the full list. A figure whose source failed (undefined) is shown as unavailable, never 0.
 */
export function LeadDashboardOverview({
  unassigned,
  coordinators,
}: {
  unassigned: Loaded<number>;
  coordinators: Loaded<LeadCoordinator[]>;
}) {
  const ranked = coordinators && [...coordinators].sort((a, b) => b.workload - a.workload || a.full_name.localeCompare(b.full_name));
  const busiest = ranked?.[0];
  const least = ranked && ranked.length > 1 ? ranked[ranked.length - 1] : undefined;

  return (
    <>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Summary">
        <Stat icon={ClipboardList} label="Unassigned requests" value={unassigned} />
        <Stat icon={CalendarClock} label="Active events" value={coordinators?.reduce((sum, c) => sum + c.workload, 0)} />
        <Stat icon={Users} label="Coordinators" value={coordinators?.length} />
      </ul>

      <Card>
        <CardHeader>
          <CardTitle>Coordinator workload</CardTitle>
          <p className="text-xs text-muted-foreground">Active events, busiest and least busy.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!coordinators ? (
            <p className="text-sm text-muted-foreground">Workload is unavailable right now.</p>
          ) : !busiest ? (
            <p className="text-sm text-muted-foreground">No coordinators are assigned to you.</p>
          ) : (
            <ul className="space-y-4">
              {[
                { role: "Busiest", coordinator: busiest },
                ...(least ? [{ role: "Least busy", coordinator: least }] : []),
              ].map(({ role, coordinator: c }) => (
                <li key={role} className="space-y-1.5">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{role}</p>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">{c.full_name}</span>
                    <span className="text-sm">
                      <span className="font-heading text-xl font-bold">{c.workload}</span> active
                    </span>
                  </div>
                  {/* same scale for both rows, so the bars compare like with like; the number carries the meaning */}
                  <div className="h-1.5 rounded-full bg-muted" aria-hidden="true">
                    <div className="h-full rounded-full bg-fg-primary" style={{ width: `${(c.workload / Math.max(1, busiest.workload)) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link className={buttonVariants({ variant: "outline" })} href="/lead/coordinators">
            View all coordinators
          </Link>
        </CardContent>
      </Card>
    </>
  );
}
