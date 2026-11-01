import Link from "next/link";
import { ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { OUT_OF_SERVICE_DISPLAY } from "@/lib/status";
import { newAssignments, outOfService } from "@/lib/technicalSupportDashboard";
import type { TechnicalSupportDashboardData } from "@/lib/technicalSupportDashboardServer";

// How many rows a card shows before pointing at the full page.
const SHOWN = 5;

const Unavailable = () => (
  <p className="flex items-center gap-2 text-base font-medium text-status-warning-fg">
    <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
    Unavailable
  </p>
);

const rowLink =
  "flex items-center gap-3 rounded-lg border border-transparent px-3 py-3 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring";

/**
 * SCRUM-164 (Figma 18): the Technical Support Staff Home. What to do first (new on-site assignments), the equipment
 * requests waiting with their count linking to the queue, and the items out of service. A source that failed
 * (undefined) is shown as unavailable, never as 0 or "nothing to do".
 */
export function TechnicalSupportDashboardOverview({ requests, items, notifications }: TechnicalSupportDashboardData) {
  const assignments = notifications && newAssignments(notifications);
  const out = items && outOfService(items);

  return (
    <>
      <section aria-labelledby="needs-your-action" className="space-y-3">
        <h2 id="needs-your-action" className="font-heading text-xl font-bold">Needs your action</h2>
        {!assignments && <Unavailable />}
        {assignments?.length === 0 && (
          <p className="flex items-center gap-3 rounded-xl bg-muted p-4 text-base font-medium">
            <CircleCheck className="size-6 shrink-0 text-status-success-fg" aria-hidden="true" />
            No new on-site assignments. You are all caught up.
          </p>
        )}
        {!!assignments?.length && (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {assignments.slice(0, SHOWN).map((n) => (
              <li key={n.id}>
                <Link href="/notifications" aria-label={`Open ${n.title}`} className={rowLink}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold">{n.title}</span>
                    <span className="block text-sm text-muted-foreground">{n.message}</span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {assignments && assignments.length > SHOWN && (
          <p className="text-sm text-muted-foreground">
            Showing {SHOWN} of {assignments.length}. See the rest in <Link className="underline" href="/notifications">Notifications</Link>.
          </p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="equipment-requests" className="space-y-3">
          <h2 id="equipment-requests" className="font-heading text-xl font-bold">Equipment requests</h2>
          <Card>
            <CardContent className="space-y-3">
              {!requests ? (
                <Unavailable />
              ) : requests.length === 0 ? (
                <p className="text-base text-muted-foreground">No requests waiting for action.</p>
              ) : (
                <ul className="space-y-1">
                  {requests.slice(0, SHOWN).map((r) => (
                    <li key={r.id}>
                      <Link href={`/equipment-requests/${r.id}`} className={rowLink}>
                        <span className="min-w-0 flex-1">
                          <span className="block text-base font-medium">{r.eventName} · {r.equipment} ×{r.quantity}</span>
                          <span className="block text-sm text-muted-foreground">{[r.venueName, r.eventDate].filter(Boolean).join(" · ")}</span>
                        </span>
                        {r.updated && <StatusBadge tone="info" label="Updated" icon="repeat" />}
                        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/equipment-requests" className="inline-flex items-center gap-1 rounded-lg px-3 text-base font-medium text-fg-primary underline-offset-4 hover:underline">
                {requests ? `View all ${requests.length} ${requests.length === 1 ? "request" : "requests"}` : "View equipment requests"}
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="out-of-service" className="space-y-3">
          <h2 id="out-of-service" className="font-heading text-xl font-bold">Out of service</h2>
          <Card>
            <CardContent className="space-y-3">
              {!out ? (
                <Unavailable />
              ) : out.length === 0 ? (
                <p className="text-base text-muted-foreground">Everything in the catalogue is working.</p>
              ) : (
                <ul className="space-y-1">
                  {out.slice(0, SHOWN).map((i) => (
                    <li key={i.id} className="flex items-center gap-3 px-3 py-3">
                      <span className="min-w-0 flex-1 text-base font-medium">{i.name}</span>
                      <StatusBadge {...OUT_OF_SERVICE_DISPLAY[i.outOfService]} />
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/equipment-inventory" className="inline-flex items-center gap-1 rounded-lg px-3 text-base font-medium text-fg-primary underline-offset-4 hover:underline">
                View inventory
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>
        </section>
      </div>
    </>
  );
}
