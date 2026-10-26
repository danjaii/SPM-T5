import { Card, CardContent } from "@/components/ui/card";
import { registrationSummary, STATUS_LABELS, type EventRegistration, type RegistrationStatus } from "@/lib/eventRegistration";

// SCRUM-74/AC6: the summary above an event's registrations: the total, and the number in each status.
// SCRUM-139/AC4 (Figma 15): one card for each figure, and the count against capacity ("9 of 10 places") on Confirmed and Places left.
export function RegistrationSummary({ registrations, capacity }: { registrations: EventRegistration[]; capacity: number | null }) {
  const summary = registrationSummary(registrations, capacity);
  const statuses = Object.keys(STATUS_LABELS) as RegistrationStatus[];

  const cards: { label: string; value: string | number; note: string }[] = [
    { label: "Total registrations", value: summary.total, note: "in every status" },
    ...statuses.map((status) => ({
      label: STATUS_LABELS[status],
      value: summary.byStatus[status],
      // SCRUM-74/AC7: only Confirmed registrations use a place; SCRUM-139/AC4: shown against the capacity
      note: status === "confirmed" ? (capacity === null ? "No limit on places" : `of ${capacity} places`) : "do not use a place",
    })),
    // SCRUM-74/AC6: an event with no capacity has no limit
    {
      label: "Slots remaining",
      value: summary.slotsRemaining === null ? "No limit" : `${summary.slotsRemaining} of ${capacity}`,
      note: "capacity less Confirmed",
    },
  ];

  return (
    <ul aria-label="Registration summary" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => (
        <li key={c.label}>
          <Card className="h-full">
            <CardContent className="space-y-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{c.label}</p>
              <p className="font-heading text-2xl font-bold">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.note}</p>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
