import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { EquipmentRequestDetailView } from "@/lib/equipmentRequests";
import { EQUIPMENT_STATUS_DISPLAY } from "@/lib/status";
import { SentBackNotice } from "./SentBackNotice";

// SCRUM-87/AC3: one request in full, whatever its status. AC5: a Cannot Fulfil request shows its reason.
// SCRUM-88/AC2: a request the coordinator changed is marked Updated; AC8: who last changed it, and when.
// SCRUM-136/AC6: the status is a StatusBadge, an icon and a label.
export function EquipmentRequestDetail({ request }: { request: EquipmentRequestDetailView }) {
  const facts: [string, React.ReactNode][] = [
    ["Event", <Link key="event" href={`/events/${request.eventId}`} className="font-semibold text-fg-primary underline-offset-4 hover:underline">{request.eventName}</Link>],
    ["Event date", request.eventDate],
    ["Time", `${request.startTime}–${request.endTime}`],
    ["Venue", request.venueName ?? "No venue"],
    ["Equipment", request.equipment],
    ["Quantity", request.quantity],
    ["Technical notes", request.notes || "None"],
    ...(request.lastChangedBy ? [["Last changed", `${request.lastChangedBy}, ${request.lastChangedAt}`] as [string, React.ReactNode]] : []),
  ];

  return (
    <section aria-labelledby="equipment-request-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 id="equipment-request-heading" className="text-3xl font-bold tracking-tight text-foreground">{request.equipment}</h1>
        <StatusBadge {...EQUIPMENT_STATUS_DISPLAY[request.status]} label={request.statusLabel} />
        {request.updated && <StatusBadge tone="info" icon="info" label="Updated" />}
      </div>
      <SentBackNotice note={request.sentBack} />

      <Card className="p-6">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
          {facts.map(([term, value]) => (
            <div key={term} className="flex flex-col gap-0.5">
              <dt className="text-sm text-muted-foreground">{term}</dt>
              <dd className="font-medium text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {request.reason && (
        <Card className="gap-2 p-6">
          <h2 className="text-lg font-bold">Why it cannot be fulfilled</h2>
          <p>{request.reason}</p>
        </Card>
      )}
    </section>
  );
}
