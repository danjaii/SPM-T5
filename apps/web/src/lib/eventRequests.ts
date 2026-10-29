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

/** SCRUM-53/AC1: store the request as it stands, however much is filled in (POST /events/drafts). */
export async function saveEventDraft(body: Record<string, unknown>): Promise<ApiResult<{ id?: string; updated_at?: string }>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/drafts`, {
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

/** SCRUM-54/AC2: save the draft again. The whole form is sent, so a box left empty is cleared in the draft (PUT /events/drafts/:id). */
export async function updateEventDraft(id: string, body: Record<string, unknown>): Promise<ApiResult<{ id?: string; updated_at?: string; code?: string }>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/drafts/${encodeURIComponent(id)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } };
  }
}

/** SCRUM-54/AC3: submit the draft with the form as it stands now (POST /events/drafts/:id/submit): the same request, not a second one. */
export async function submitEventDraft(id: string, body: Record<string, unknown>): Promise<ApiResult<{ id?: string }>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/drafts/${encodeURIComponent(id)}/submit`, {
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
