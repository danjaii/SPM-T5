import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { registrationSummary, STATUS_LABELS, type EventRegistration, type RegistrationStatus } from "@/lib/eventRegistration";

interface SummaryCard {
  label: string;
  value: string | number;
  note: string;
  /** Percentage of the places taken, for the one card that shows a bar. */
  bar?: number;
}

// SCRUM-74/AC6: the summary above an event's registrations: the total, and the number in each status.
// SCRUM-139/AC4 (Figma 15): one card for each figure, and the count against capacity ("9 of 10 places") on Confirmed and Slots remaining.
// Redesign (similarity, proximity, common region): the figures about places (total, confirmed, slots remaining) are a large first row;
// the statuses that do not use a place are a quieter second row, so six cards read as two groups, not one long strip.
export function RegistrationSummary({ registrations, capacity }: { registrations: EventRegistration[]; capacity: number | null }) {
  const summary = registrationSummary(registrations, capacity);
  const otherStatuses = (Object.keys(STATUS_LABELS) as RegistrationStatus[]).filter((s) => s !== "confirmed");

  const taken = capacity ? Math.min(100, Math.round((summary.byStatus.confirmed / capacity) * 100)) : undefined;

  const places: SummaryCard[] = [
    { label: "Total registrations", value: summary.total, note: "in every status" },
    {
      label: STATUS_LABELS.confirmed,
      value: summary.byStatus.confirmed,
      // SCRUM-74/AC7: only Confirmed registrations use a place; SCRUM-139/AC4: shown against the capacity
      note: capacity === null ? "No limit on places" : `of ${capacity} places`,
      bar: taken,
    },
    // SCRUM-74/AC6: an event with no capacity has no limit
    {
      label: "Slots remaining",
      value: summary.slotsRemaining === null ? "No limit" : `${summary.slotsRemaining} of ${capacity}`,
      note: "capacity less Confirmed",
    },
  ];
  const others: SummaryCard[] = otherStatuses.map((status) => ({
    label: STATUS_LABELS[status],
    value: summary.byStatus[status],
    note: "do not use a place",
  }));

  return (
    <ul aria-label="Registration summary" className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {[...places.map((c) => ({ c, primary: true })), ...others.map((c) => ({ c, primary: false }))].map(({ c, primary }) => (
        <li key={c.label}>
          <Card className={cn("h-full", !primary && "bg-muted/40 shadow-none")}>
            <CardContent className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{c.label}</p>
              <p className={cn("font-heading font-bold", primary ? "text-3xl" : "text-xl")}>{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.note}</p>
              {c.bar !== undefined && <Progress className="pt-1" value={c.bar} aria-label={`${c.bar}% of places taken`} />}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
