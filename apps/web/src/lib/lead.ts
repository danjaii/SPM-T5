import { EVENT_URL, type ApiResult } from "./api";

// Browser-safe calls to event-service's Lead routes (the server-side loaders are in ./leadServer).

type Changed = ApiResult<{ assigned_coordinator_id: string }>;

/** SCRUM-78/AC2: assign an unassigned event; SCRUM-79/AC3: reassign an assigned one. */
export async function leadChangeCoordinator(action: "assign" | "reassign", eventId: string, coordinatorId: string): Promise<Changed> {
  try {
    const res = await fetch(`${EVENT_URL}/lead/events/${encodeURIComponent(eventId)}/${action}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinator_id: coordinatorId }),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as Changed["data"] };
  }
}
