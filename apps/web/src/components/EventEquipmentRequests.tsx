"use client";

import { Fragment, useState } from "react";
import { Plus } from "lucide-react";
import { EquipmentItemEditor } from "@/components/equipment/EquipmentItemEditor";
import { EmptyNote, EventSection } from "@/components/event/EventSection";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EquipmentRequestFormData, EventEquipmentRequestsView } from "@/lib/equipmentRequests";
import { EQUIPMENT_STATUS_DISPLAY } from "@/lib/status";

// SCRUM-86/AC2, AC3: the event's equipment requests, each with its own status. Shown to the assigned coordinator and
// Technical Support Staff (equipment-service answers nobody else); null means no section. AC6, AC7: adding is offered
// only when equipment-service says the viewer may add one. SCRUM-87/AC5: a Cannot Fulfil request shows its reason under
// the status; AC6: whether the event's equipment is ready (Complete or Incomplete).
// SCRUM-88/AC1: a Change button on each request the viewer may change; AC8: who last changed it, and when.
// SCRUM-136/AC1: Add item and Change open a one-row editor in place, using the request form's choices (`form`).
export function EventEquipmentRequests({
  data,
  form,
}: {
  data: EventEquipmentRequestsView | null;
  form?: EquipmentRequestFormData | null;
}) {
  // "new" while adding, a request's id while changing it, null otherwise. One row is open at a time.
  const [editing, setEditing] = useState<string | null>(null);
  if (!data) return null;
  const close = () => setEditing(null);
  const anyEditable = Boolean(form) && data.requests.some((r) => r.canEdit);
  const columns = anyEditable ? 6 : 5;
  return (
    <EventSection
      id="equipment-requests-heading"
      title="Equipment requests"
      action={data.canCreate && form && editing !== "new" && (
        <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" /> Add item
        </Button>
      )}
    >
      {data.readinessLabel && (
        <p className="flex items-center gap-2 text-sm">
          Equipment <StatusBadge tone="info" label={data.readinessLabel} />
        </p>
      )}
      {editing === "new" && form && <EquipmentItemEditor form={form} onDone={close} onCancel={close} />}
      {data.requests.length === 0 ? (
        <EmptyNote>No equipment has been requested for this event yet.</EmptyNote>
      ) : (
        <Table>
          <TableHeader className="max-md:sr-only">
            <TableRow>
              <TableHead>Equipment</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>Venue</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Status</TableHead>
              {anyEditable && <TableHead><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.requests.map((r) => (
              <Fragment key={r.id}>
                {editing === r.id && form ? (
                  <TableRow className="max-md:flex max-md:flex-col">
                    <TableCell colSpan={columns} className="whitespace-normal max-md:p-0">
                      <EquipmentItemEditor form={form} existing={r} onDone={close} onCancel={close} />
                    </TableCell>
                  </TableRow>
                ) : (
                  // AC8: below the md breakpoint each row stacks into a card, so nothing is squeezed or scrolls sideways
                  <TableRow className="max-md:flex max-md:flex-col max-md:gap-1 max-md:p-3">
                    <TableCell className="font-medium whitespace-normal max-md:p-0">{r.equipment}</TableCell>
                    <TableCell className="max-md:p-0">{r.quantity}</TableCell>
                    <TableCell className="whitespace-normal max-md:p-0">{r.venueName ?? "No venue"}</TableCell>
                    <TableCell className="whitespace-normal max-md:p-0">{r.notes ?? "—"}</TableCell>
                    <TableCell className="whitespace-normal max-md:p-0">
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
                      <TableCell className="max-md:p-0">
                        {r.canEdit && (
                          <Button variant="outline" size="sm" onClick={() => setEditing(r.id)} aria-label={`Change the ${r.equipment} request`}>
                            Change
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </EventSection>
  );
}
