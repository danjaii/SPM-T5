import type { NotificationItem } from "@spm-t5/shared";
import type { InventoryItemView } from "./equipmentInventory";
import type { EquipmentQueueItemView } from "./equipmentRequests";
import type { LeadKpi } from "./leadQueueView";

// SCRUM-164: the pure rules behind the Technical Support Staff Home, kept apart from the fetching so they can be tested alone.

const ASSIGNMENT_TYPES = ["technical_assignment_assigned", "technical_assignment_changed"];

/** AC3: assignment notifications whose current details the technician has not acknowledged yet, newest first as served. */
export function newAssignments(items: NotificationItem[]): NotificationItem[] {
  return items.filter((n) => ASSIGNMENT_TYPES.includes(n.type) && n.acknowledgement?.canAcknowledge === true && !n.acknowledgement.acknowledgedAt);
}

/** AC2: catalogue items that cannot be used at all, with the reason (set by equipment-service). */
export function outOfService(items: InventoryItemView[]): (InventoryItemView & { outOfService: NonNullable<InventoryItemView["outOfService"]> })[] {
  return items.flatMap((i) => (i.outOfService ? [{ ...i, outOfService: i.outOfService }] : []));
}

/** The figures above the page. A source that failed (undefined) is left out, never shown as 0. */
export function technicalSupportKpis(
  requests: EquipmentQueueItemView[] | undefined,
  items: InventoryItemView[] | undefined,
  assignments: NotificationItem[] | undefined,
): LeadKpi[] {
  const kpis: LeadKpi[] = [];
  if (requests) {
    const updated = requests.filter((r) => r.updated).length;
    kpis.push({ label: "Requests to review", value: requests.length, note: updated > 0 ? `${updated} updated by the coordinator` : "Submitted and waiting" });
  }
  if (items) {
    const out = outOfService(items);
    kpis.push({ label: "Out of service", value: out.length, note: out.length > 0 ? out.map((i) => i.name).join(", ") : "Everything is working", warn: out.length > 0 });
  }
  if (assignments) {
    kpis.push({ label: "New assignments", value: assignments.length, note: assignments.length > 0 ? "Acknowledge them below" : "None waiting" });
  }
  return kpis;
}
