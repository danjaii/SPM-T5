import type { EquipmentQueueItemView } from "./equipmentRequests";

/** SCRUM-136/AC2: one event in the Technical Support queue (Figma frame 11) and its waiting requests. */
export interface QueueEventGroup {
  eventId: string;
  eventName: string;
  eventDate: string;
  items: EquipmentQueueItemView[];
}

/**
 * Groups the queue by event without reordering it: equipment-service already lists the soonest event first and, within
 * it, the oldest request first (SCRUM-87), so each event sits where its first request was.
 */
export function groupQueueByEvent(requests: EquipmentQueueItemView[]): QueueEventGroup[] {
  const groups = new Map<string, QueueEventGroup>();
  for (const r of requests) {
    const group = groups.get(r.eventId) ?? { eventId: r.eventId, eventName: r.eventName, eventDate: r.eventDate, items: [] };
    group.items.push(r);
    groups.set(r.eventId, group);
  }
  return [...groups.values()];
}
