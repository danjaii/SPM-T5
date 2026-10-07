import { EVENT_URL, type ApiResult } from "./api";

export interface EventStatusView {
  id: string;
  name: string;
  status: string;
  /** Whether the viewer may change the status (event-service decides: the assigned coordinator only). */
  canChangeStatus: boolean;
  /** SCRUM-24/AC5: whether the viewer may approve or reject (event-service decides: the assigned coordinator only). */
  canReview: boolean;
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
  /** SCRUM-42/AC5: the assigned coordinator's name, or null while unassigned. */
  point_of_contact_name: string | null;
  /** SCRUM-42/AC8: whether the viewer may (re)assign the coordinator (event-service decides). */
  canAssign: boolean;
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

type EventSummary = { id: string; name: string; status: string };

async function decide(id: string, action: "approve" | "reject", body: object): Promise<ApiResult<EventSummary>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}

/** SCRUM-24/AC1: approve a request awaiting a decision. */
export const approveEvent = (id: string) => decide(id, "approve", {});

/** SCRUM-24/AC2: reject a request awaiting a decision; the reason is required. */
export const rejectEvent = (id: string, reason: string) => decide(id, "reject", { reason });

export interface CoordinatorOption {
  id: string;
  full_name: string | null;
}

/** SCRUM-43/AC2: one assignment or reassignment, oldest first. */
export interface AssignmentRecord {
  coordinator_id: string;
  previous_coordinator_id: string | null;
  assigned_by: string;
  assigned_at: string;
  coordinator_name: string | null;
  previous_coordinator_name: string | null;
  assigned_by_name: string | null;
}

async function getFromEventService<T>(path: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/${path}`, { credentials: "include", cache: "no-store" });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}

/** SCRUM-42/AC1, AC2: active coordinators who could take the event (the current one is left out). */
export const fetchEligibleCoordinators = (id: string) =>
  getFromEventService<CoordinatorOption[]>(`${encodeURIComponent(id)}/eligible-coordinators`);

/** SCRUM-43/AC1: the event's assignment history. */
export const fetchAssignmentHistory = (id: string) =>
  getFromEventService<AssignmentRecord[]>(`${encodeURIComponent(id)}/assignment-history`);

/** SCRUM-42/AC3, SCRUM-41/AC3: make this coordinator the event's assigned coordinator. */
export async function assignCoordinator(
  id: string,
  coordinatorId: string,
): Promise<ApiResult<{ assigned_coordinator_id: string }>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/${encodeURIComponent(id)}/assign-coordinator`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinator_id: coordinatorId }),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}

/** SCRUM-44: the coordinator's decision on a request, from GET /events/:id/outcome; null while there is none. */
export interface ReviewDecision {
  outcome: "approved" | "rejected";
  decided_at: string;
  reason: string | null;
  decided_by_name: string | null;
}

/** SCRUM-25/AC2: one comment, as GET /events/:id/comments returns it (oldest first, AC3). */
export interface EventComment {
  id: string;
  body: string;
  created_at: string;
  parent_comment_id: string | null;
  author_name: string | null;
}

/** SCRUM-25/AC5: can_comment says whether the viewer may add to the conversation. */
export interface EventComments {
  can_comment: boolean;
  comments: EventComment[];
}

/** SCRUM-25/AC2, AC3: the event's comments. */
export const fetchEventComments = (id: string) =>
  getFromEventService<EventComments>(`${encodeURIComponent(id)}/comments`);

/** SCRUM-25/AC1: add a comment to the event. */
export async function addEventComment(id: string, body: string): Promise<ApiResult<Record<string, never>>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/${encodeURIComponent(id)}/comments`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}
