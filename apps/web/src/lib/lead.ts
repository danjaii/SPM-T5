import { EVENT_URL, type ApiResult } from "./api";

// Browser-safe calls to event-service's Lead routes (the server-side loaders are in ./leadServer).

/** SCRUM-78/AC2: assign the chosen coordinator to an unassigned event. */
export async function leadAssign(eventId: string, coordinatorId: string): Promise<ApiResult<{ assigned_coordinator_id: string }>> {
  try {
    const res = await fetch(`${EVENT_URL}/lead/events/${encodeURIComponent(eventId)}/assign`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinator_id: coordinatorId }),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as ApiResult<{ assigned_coordinator_id: string }>["data"] };
  }
}
