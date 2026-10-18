import { cookies } from "next/headers";
import { isRole, type Role } from "@spm-t5/shared";
import { SERVER_AUTH_URL, SERVER_EQUIPMENT_URL, SERVER_EVENT_URL, SERVER_VENUE_URL, SESSION_COOKIE } from "./api";
import type { QueueCounts, QueueKey } from "./nav";

// Server-only: the app shell's own reads. Unlike the page helpers it never redirects: a signed-out visitor, or a service
// that is down, just means no shell or no count, and the page itself still renders.

export interface ShellData {
  user: { fullName: string; role: Role };
  counts: QueueCounts;
}

// Where each queue lives: the same routes the queue pages read. Each answers with the list itself, a JSON array.
const QUEUES: Record<QueueKey, { base: string; path: string }> = {
  leadQueue: { base: SERVER_EVENT_URL, path: "/lead/queue" },
  bookingQueue: { base: SERVER_VENUE_URL, path: "/booking-queue" },
  equipmentQueue: { base: SERVER_EQUIPMENT_URL, path: "/equipment-requests" },
  safetyQueue: { base: SERVER_EVENT_URL, path: "/safety-checks" },
};

const QUEUE_FOR_ROLE: Partial<Record<Role, QueueKey>> = {
  event_coordinator_lead: "leadQueue",
  venue_staff: "bookingQueue",
  technical_support_staff: "equipmentQueue",
  safety_officer: "safetyQueue",
};

async function queueSize(key: QueueKey, headers: HeadersInit): Promise<number | undefined> {
  const { base, path } = QUEUES[key];
  try {
    const res = await fetch(`${base}${path}`, { headers, cache: "no-store" });
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    return Array.isArray(body) ? body.length : undefined;
  } catch {
    return undefined;
  }
}

/** SCRUM-121: who is signed in and how many items wait in their queue; null when nobody is signed in. */
export async function getShellData(): Promise<ShellData | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const headers = { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` };

  let user: { fullName?: string; role?: string };
  try {
    const me = await fetch(`${SERVER_AUTH_URL}/auth/me`, { headers, cache: "no-store" });
    if (!me.ok) return null;
    user = await me.json();
  } catch {
    return null;
  }
  if (!isRole(user.role)) return null;

  const key = QUEUE_FOR_ROLE[user.role];
  const size = key ? await queueSize(key, headers) : undefined;
  return {
    user: { fullName: user.fullName ?? "", role: user.role },
    counts: key && size !== undefined ? { [key]: size } : {},
  };
}
