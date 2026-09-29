import { EVENT_URL, type ApiResult } from "./api";

export interface EventStatusView {
  id: string;
  name: string;
  status: string;
  /** Whether the viewer may change the status (event-service decides: the assigned coordinator only). */
  canChangeStatus: boolean;
}

/** "under_review" -> "Under review" */
export const statusLabel = (status: string) => {
  const words = status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** SCRUM-8: ask event-service, from the browser, to change an event's status. */
export async function changeEventStatus(
  id: string,
  status: string,
  reason: string,
): Promise<ApiResult<{ id: string; name: string; status: string }>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reason.trim() ? { status, reason: reason.trim() } : { status }),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}
