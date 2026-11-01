import { equipmentOptionLabel, type NotificationItem } from "@spm-t5/shared";
import type { InventoryItemView } from "./equipmentInventory";
import type { EquipmentQueueItemView } from "./equipmentRequests";
import type { LeadKpi } from "./leadQueueView";
import { availabilityDisplay, type StatusDisplay } from "./status";

// SCRUM-164 (Figma 18): the pure rules behind the Technical Support Staff Home, kept apart from the fetching so they can be tested alone.

const ASSIGNMENT_TYPES = ["technical_assignment_assigned", "technical_assignment_changed"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** On-site assignments whose current details the technician has not acknowledged yet, newest first as served. */
export function newAssignments(items: NotificationItem[]): NotificationItem[] {
  return items.filter((n) => ASSIGNMENT_TYPES.includes(n.type) && n.acknowledgement?.canAcknowledge === true && !n.acknowledgement.acknowledgedAt);
}

/** "Good morning" until noon, "Good afternoon" until six, then "Good evening", by the hour in Singapore. */
export function greeting(now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", hour: "numeric", hourCycle: "h23" }).format(now));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** "5 Dec" from an event's "2026-12-05". */
export function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export interface RequestRow {
  request: EquipmentQueueItemView;
  /** The mock-up's Available / Partial / Unavailable; undefined when the item is not in the inventory. */
  availability?: StatusDisplay;
  free?: number;
}

/** AC1: each waiting request with whether enough units are free for it. Any shortfall is a shortage. */
export function requestRows(requests: EquipmentQueueItemView[], items: InventoryItemView[] | undefined): RequestRow[] {
  return requests.map((request) => {
    // the queue words equipment as the request form does ("Audio: Wireless microphones"), so match on that label
    const item = items?.find((i) => equipmentOptionLabel(i) === request.equipment);
    if (!item) return { request };
    const shown = availabilityDisplay(item.available, request.quantity);
    return { request, free: item.available, availability: shown.label === "Enough" ? { ...shown, label: "Available" } : shown };
  });
}

/** The equipment names some waiting request is short of. */
export function shortages(rows: RequestRow[]): string[] {
  return [...new Set(rows.filter((r) => r.availability && r.availability.label !== "Available").map((r) => r.request.equipment))];
}

/** "5 requests need a reservation. 2 items are short." */
export function homeSummary(requests: EquipmentQueueItemView[] | undefined, short: string[]): string {
  if (!requests) return "Some figures could not be loaded.";
  const n = requests.length;
  return `${n} ${n === 1 ? "request needs" : "requests need"} a reservation. ${short.length} ${short.length === 1 ? "item is" : "items are"} short.`;
}

/** The four figures above the page. A figure whose source failed (undefined) is left out, never shown as 0. */
export function technicalSupportKpis(
  requests: EquipmentQueueItemView[] | undefined,
  items: InventoryItemView[] | undefined,
  assignments: NotificationItem[] | undefined,
  short: string[],
  now = new Date(),
): LeadKpi[] {
  const kpis: LeadKpi[] = [];
  if (requests) {
    const thisWeek = requests.filter((r) => {
      const days = (Date.parse(`${r.eventDate}T00:00:00Z`) - now.getTime()) / DAY_MS;
      return days >= -1 && days < 7;
    }).length;
    kpis.push({ label: "New requests", value: requests.length, note: `${thisWeek} ${thisWeek === 1 ? "is" : "are"} for this week` });
  }
  if (requests && items) {
    kpis.push({ label: "Shortages", value: short.length, note: short.length > 0 ? short.join(", ") : "Nothing is short", href: short.length > 0 ? "/equipment-inventory" : undefined });
  }
  if (items) {
    const holders = new Set(items.flatMap((i) => i.heldBy.map((h) => h.eventName)));
    kpis.push({ label: "Reserved today", value: items.reduce((sum, i) => sum + i.heldBy.reduce((s, h) => s + h.units, 0), 0), note: `Held by ${holders.size} ${holders.size === 1 ? "event" : "events"}` });
  }
  if (assignments) {
    kpis.push({ label: "On-site next", value: assignments.length, note: assignments[0] ? (assignments[0].related?.label ?? assignments[0].title) : "No new assignments" });
  }
  return kpis;
}
