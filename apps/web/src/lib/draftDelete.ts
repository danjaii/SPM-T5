import { EVENT_URL } from "@/lib/api";

export type DeleteDraftResult = { ok: true } | { ok: false; error: string };

/** SCRUM-56/AC1: deletes one of the signed-in organiser's draft event requests, from the browser, sending the session cookie. */
export async function deleteDraft(id: string): Promise<DeleteDraftResult> {
  try {
    const res = await fetch(`${EVENT_URL}/events/drafts/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
    if (res.ok) return { ok: true };
    // event-service's reason, e.g. the request has been submitted since the page loaded; a 204 has no body but an error does
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: body.error ?? "Could not delete the draft." };
  } catch {
    return { ok: false, error: "We couldn't reach the server. Please try again." };
  }
}
