import Link from "next/link";
import { Box, TriangleAlert } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge, StatusIcon } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { OUT_OF_SERVICE_DISPLAY, type StatusTone } from "@/lib/status";
import { requestRows, shortDate, type RequestRow } from "@/lib/technicalSupportDashboard";
import type { TechnicalSupportDashboardData } from "@/lib/technicalSupportDashboardServer";

// The mock-up lists five requests and four items.
const SHOWN_REQUESTS = 5;
const SHOWN_ITEMS = 4;

const Unavailable = () => (
  <p className="flex items-center gap-2 p-4 text-base font-medium text-status-warning-fg">
    <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
    Unavailable
  </p>
);

const TILE: Record<StatusTone, string> = {
  neutral: "bg-status-neutral text-status-neutral-fg",
  info: "bg-status-info text-status-info-fg",
  warning: "bg-status-warning text-status-warning-fg",
  success: "bg-status-info text-status-info-fg",
  danger: "bg-status-danger text-status-danger-fg",
};

/** What the row says under the title: what is short, or where the equipment goes. */
function peek({ request, free, availability }: RequestRow): string {
  if (availability?.label === "Unavailable") return `Needs ${request.quantity} · none free on ${shortDate(request.eventDate)}`;
  if (availability?.label === "Partial") return `Needs ${request.quantity} · ${free} free on ${shortDate(request.eventDate)}`;
  return [request.venueName, shortDate(request.eventDate)].filter(Boolean).join(" · ");
}

/** The row's one action: reply when nothing is free, otherwise reserve. All open the request. */
function action({ availability }: RequestRow): { label: string; primary: boolean } {
  if (availability?.label === "Unavailable") return { label: "Reply to coordinator", primary: true };
  return { label: availability ? "Reserve" : "Review", primary: false };
}

/** Free units against the total: red when none, amber when under a third, otherwise the brand colour. */
function stockTone(available: number, total: number): string {
  if (available === 0) return "bg-status-danger-fg";
  return available / total < 1 / 3 ? "bg-status-warning-fg" : "bg-primary";
}

/**
 * SCRUM-164 (Figma 18): the Technical Support Staff Home below the figures: the waiting equipment requests, each with how
 * much is free for it, and this day's stock. A source that failed (undefined) is shown as unavailable, never as 0.
 */
export function TechnicalSupportDashboardOverview({ requests, items }: TechnicalSupportDashboardData) {
  const rows = requests && requestRows(requests, items);

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[2fr_1fr]">
      <Card className="gap-0 py-0">
        <section aria-labelledby="equipment-requests">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 id="equipment-requests" className="font-heading text-lg font-bold">Equipment requests</h2>
            {requests && (
              <Link
                href="/equipment-requests"
                aria-label={`${requests.length} equipment ${requests.length === 1 ? "request" : "requests"}, open the review queue`}
                className="rounded-full bg-status-info px-2 text-xs font-semibold text-status-info-fg tabular-nums hover:underline"
              >
                {requests.length}
              </Link>
            )}
          </div>
          {!rows ? (
            <Unavailable />
          ) : rows.length === 0 ? (
            <p className="p-4 text-base text-muted-foreground">No requests waiting for action.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.slice(0, SHOWN_REQUESTS).map((row) => {
                const { request, availability } = row;
                const act = action(row);
                return (
                  <li key={request.id} className="flex items-center gap-3 p-4">
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TILE[availability?.tone ?? "info"])} aria-hidden="true">
                      {availability?.tone === "danger" || availability?.tone === "warning" ? <TriangleAlert className="size-5" /> : <Box className="size-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{request.eventName} · {request.equipment}</span>
                      <span className="block text-xs text-muted-foreground">{peek(row)}</span>
                    </span>
                    {availability && <StatusBadge {...availability} />}
                    <Link
                      href={`/equipment-requests/${request.id}`}
                      aria-label={`${act.label}: ${request.eventName}, ${request.equipment}`}
                      className={cn(buttonVariants({ variant: act.primary ? "default" : "outline", size: "sm" }), !act.primary && "border-input")}
                    >
                      {act.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </Card>

      <Card className="gap-0 py-0">
        <section aria-labelledby="stock" className="space-y-4 p-4">
          <h2 id="stock" className="font-heading text-lg font-bold">Stock today</h2>
          {!items ? (
            <Unavailable />
          ) : items.length === 0 ? (
            <p className="text-base text-muted-foreground">The catalogue has no equipment yet.</p>
          ) : (
            <ul className="space-y-3">
              {items.slice(0, SHOWN_ITEMS).map((i) => (
                <li key={i.id} className="space-y-1.5">
                  <p className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold">{i.name}</span>
                    {i.outOfService ? (
                      <span className="flex items-center gap-1 font-semibold">
                        <StatusIcon {...OUT_OF_SERVICE_DISPLAY[i.outOfService]} />
                        {OUT_OF_SERVICE_DISPLAY[i.outOfService].label}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{i.available} of {i.total} free</span>
                    )}
                  </p>
                  <Progress
                    value={i.total === 0 ? 0 : (i.available / i.total) * 100}
                    aria-label={`${i.name}: ${i.available} of ${i.total} free`}
                    indicatorClassName={stockTone(i.available, i.total)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </Card>
    </div>
  );
}
