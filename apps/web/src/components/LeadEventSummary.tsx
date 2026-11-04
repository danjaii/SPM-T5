import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { formatSgt } from "@/lib/bookingQueue";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import type { LeadEvent } from "@/lib/leadServer";

const NOT_SPECIFIED = "Not specified";

// SCRUM-78 / SCRUM-79: the event, as the Lead sees it while assigning or reassigning its coordinator. One row per
// detail, label on the left, so the Lead can scan it before choosing a coordinator. A reassignment also shows who holds
// the event now (SCRUM-79/AC2). SCRUM-168/AC7: a card on the theme tokens, like the other Lead pages.
export function LeadEventSummary({ event, coordinator }: { event: LeadEvent; coordinator?: string }) {
  const rows: [string, ReactNode][] = [
    ...(coordinator ? [["Current coordinator", coordinator] as [string, ReactNode]] : []),
    ["Event Organiser", event.organiser_name ?? "Unknown"],
    ["Preferred date and time", event.preferred_start_datetime ? formatEventDateTime(event.preferred_start_datetime, event.preferred_end_datetime) : NOT_SPECIFIED],
    ["Expected attendance", event.expected_attendance ?? NOT_SPECIFIED],
    ["Submitted", event.submitted_at ? formatSgt(event.submitted_at) : NOT_SPECIFIED],
  ];

  return (
    <Card>
      <CardContent>
        <dl aria-label="Event details" className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
