import { EQUIPMENT_URL, EVENT_URL, VENUE_URL } from "./api";
import { QUEUE_PATHS, type QueueKey } from "./nav";

// Which service answers for each queue, at the address the browser reaches it on.
const QUEUE_BASES: Record<QueueKey, string> = {
  leadQueue: EVENT_URL,
  bookingQueue: VENUE_URL,
  equipmentQueue: EQUIPMENT_URL,
  safetyQueue: EVENT_URL,
};

/** SCRUM-178/AC3: how many items wait in a queue, read from the browser so the shell can update its count without reloading the page. */
export async function fetchQueueCount(key: QueueKey): Promise<number | undefined> {
  try {
    const res = await fetch(`${QUEUE_BASES[key]}${QUEUE_PATHS[key]}`, { credentials: "include", cache: "no-store" });
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    return Array.isArray(body) ? body.length : undefined;
  } catch {
    return undefined;
  }
}
