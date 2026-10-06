import { EVENT_URL, type ApiResult } from "./api";

export interface EventStatusView {
  id: string;
  name: string;
  status: string;
  /** Whether the viewer may change the status (event-service decides: the assigned coordinator only). */
  canChangeStatus: boolean;
  /** SCRUM-66: whether the viewer is the event's organiser, and may raise a change request in its current status. */
  isOrganiser?: boolean;
  canRequestChange?: boolean;
}

/** SCRUM-23/AC2: the full request, as GET /events/:id returns it. Optional fields are null when not provided. */
export interface EventDetailView extends EventStatusView {
  purpose: string | null;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
  preferred_layout_name: string | null;
  accessibility_requirements: string | null;
  equipment_requirements_notes: string | null;
  submitted_at: string | null;
  organiser_name: string | null;
}

/** SCRUM-66/AC7: a change request as GET /events/:id/change-requests returns it. */
export interface ChangeRequestView {
  id: string;
  change_description: string;
  proposed_changes: Record<string, { from: string | number | null; to: string | number | null }> | null;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  review_notes?: string | null;
}

/** "under_review" -> "Under review" */
export const statusLabel = (status: string) => {
  const words = status.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** SCRUM-66/AC1: ask event-service, from the browser, to submit a change request. */
export async function submitChangeRequest(
  id: string,
  body: Record<string, unknown>,
): Promise<ApiResult<{ code?: string }>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/${encodeURIComponent(id)}/change-requests`, {
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
