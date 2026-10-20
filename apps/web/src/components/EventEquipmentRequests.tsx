import Link from "next/link";
import { EmptyNote, EventSection } from "@/components/event/EventSection";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EventEquipmentRequestsView } from "@/lib/equipmentRequests";
import { EQUIPMENT_STATUS_DISPLAY } from "@/lib/status";

// SCRUM-86/AC2, AC3: the event's equipment requests, each with its own status. Shown to the assigned coordinator and
// Technical Support Staff (equipment-service answers nobody else); null means no section. AC6, AC7: the Request
// equipment button only when equipment-service says the viewer may add one. SCRUM-87/AC5: a Cannot Fulfil request
// shows its reason under the status; AC6: whether the event's equipment is ready (Complete or Incomplete).
// SCRUM-88/AC1: a Change link on each request the viewer may change; AC8: who last changed it, and when.
export function EventEquipmentRequests({ eventId, data }: { eventId: string; data: EventEquipmentRequestsView | null }) {
  if (!data) return null;
  const anyEditable = data.requests.some((r) => r.canEdit);
  return (
    <EventSection
      id="equipment-requests-heading"
      title="Equipment requests"
      action={data.canCreate && (
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={`/events/${eventId}/equipment-request`}>Request equipment</Link>
      )}
    >
      {data.readinessLabel && (
        <p className="flex items-center gap-2 text-sm">
          Equipment <StatusBadge tone="info" label={data.readinessLabel} />
        </p>
      )}
      {data.requests.length === 0 ? (
        <EmptyNote>No equipment has been requested for this event yet.</EmptyNote>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Equipment</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Venue</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Status</TableHead>
              {anyEditable && <TableHead><span className="visually-hidden">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.requests.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.equipment}</TableCell>
                <TableCell>{r.quantity}</TableCell>
                <TableCell>{r.venueName ?? "No venue"}</TableCell>
                <TableCell className="whitespace-normal">{r.notes ?? "—"}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge {...EQUIPMENT_STATUS_DISPLAY[r.status]} label={r.statusLabel} />
                    {r.reason && <span className="text-xs text-muted-foreground">Reason: {r.reason}</span>}
                    {/* SCRUM-102/AC7: released with its venue booking, which says why */}
                    {r.releasedReason && <span className="text-xs text-muted-foreground">Venue booking cancelled: {r.releasedReason}</span>}
                    {r.lastChangedBy && (
                      <span className="text-xs text-muted-foreground">Last changed by {r.lastChangedBy}, {r.lastChangedAt}</span>
                    )}
                    {/* SCRUM-113/AC2: back to Submitted after an important change; technical support review it again */}
                    {r.sentBackForReview && <span className="text-xs text-muted-foreground">Waiting for review again after an event change</span>}
                  </div>
                </TableCell>
                {anyEditable && (
                  <TableCell>
                    {r.canEdit && (
                      <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href={`/events/${eventId}/equipment-request/${r.id}`} aria-label={`Change the ${r.equipment} request`}>
                        Change
                      </Link>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </EventSection>
  );
}
