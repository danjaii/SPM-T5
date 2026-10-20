import { EVENT_URL, type ApiResult } from "./api";

export interface RoomLayoutOption {
  id: string;
  name: string;
}

/** SCRUM-123/AC4: ask event-service, from the browser, to create and submit the request (SCRUM-49). */
export async function submitEventRequest(body: Record<string, unknown>): Promise<ApiResult<{ id?: string }>> {
  try {
    const res = await fetch(`${EVENT_URL}/events`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } };
  }
}
