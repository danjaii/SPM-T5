import type { AffectedArrangement, EventDetailsFormValues } from "@spm-t5/shared";
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
  /** SCRUM-111/AC5: details the coordinator can edit. */
  description?: string | null;
  category_name?: string | null;
  venue_requirements?: string | null;
  /** SCRUM-111/AC6, AC7: whether this viewer may edit the event's details (the assigned coordinator, while not finished). */
  canEdit?: boolean;
}

/** SCRUM-111/AC2: GET /events/:id/edit-form, what the edit form starts with and offers. */
export interface EventEditForm {
  values: EventDetailsFormValues;
  categories: { id: string; name: string }[];
  roomLayouts: { id: string; name: string }[];
  /** The form's boxes for important fields (they may affect venue or equipment arrangements). */
  importantFields: string[];
}

/** SCRUM-111/AC4: one saved edit, as GET /events/:id/change-history returns it (newest first). */
export interface EventChangeHistoryEntry {
  id: string;
  changedAt: string;
  changedBy: string | null;
  important: boolean;
  changes: { field: string; label: string; from: unknown; to: unknown }[];
}

/** SCRUM-111/AC1: ask event-service, from the browser, to save the edited details. */
export async function saveEventDetails(
  id: string,
  values: Record<string, unknown>,
): Promise<ApiResult<{ important?: boolean; code?: string; affected?: AffectedArrangement[] }>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } };
  }
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

/** SCRUM-43/AC1: the event's assignment history. */
export const fetchAssignmentHistory = (id: string) =>
  getFromEventService<AssignmentRecord[]>(`${encodeURIComponent(id)}/assignment-history`);

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
  /** SCRUM-27/AC3: who the body's @[userId] markers refer to. */
  mentions: Array<{ user_id: string; full_name: string | null }>;
  /** SCRUM-28/AC2: files attached to the comment. */
  attachments: Attachment[];
}

/** SCRUM-28: a stored file, by its name and its path in the event-attachments bucket. */
export interface Attachment {
  file_name: string;
  storage_path: string;
}

/** SCRUM-25/AC5: can_comment says whether the viewer may add to the conversation. */
export interface EventComments {
  can_comment: boolean;
  comments: EventComment[];
}

/** SCRUM-25/AC2, AC3: the event's comments. */
export const fetchEventComments = (id: string) =>
  getFromEventService<EventComments>(`${encodeURIComponent(id)}/comments`);

/** SCRUM-27/AC1, AC5: the people who may be mentioned on this event (its coordinators and organiser). */
export const fetchMentionableUsers = (id: string) =>
  getFromEventService<CoordinatorOption[]>(`${encodeURIComponent(id)}/mentionable-users`);

async function postToEventService<T>(path: string, payload: object): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}

/**
 * SCRUM-25/AC1: add a comment to the event. SCRUM-26/AC1: or, with parentCommentId, a reply to one of its
 * comments. SCRUM-28/AC1: with the files already uploaded for it.
 */
export const addEventComment = (id: string, body: string, parentCommentId?: string, attachments: Attachment[] = []) =>
  postToEventService<Record<string, never>>(`${encodeURIComponent(id)}/comments`, {
    body,
    ...(parentCommentId && { parent_comment_id: parentCommentId }),
    ...(attachments.length > 0 && { attachments }),
  });

/** SCRUM-28/AC1: a one-time URL to upload one file to, and where it will be stored. */
export const requestUploadUrl = (id: string, file: File) =>
  postToEventService<{ upload_url: string; storage_path: string }>(`${encodeURIComponent(id)}/attachments/upload-url`, {
    file_name: file.name,
    content_type: file.type,
    size: file.size,
  });

/** SCRUM-28/AC1: send the file itself to the URL from requestUploadUrl. True once storage has it. */
export async function uploadFile(uploadUrl: string, file: File): Promise<boolean> {
  try {
    const res = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    return res.ok;
  } catch {
    return false;
  }
}

/** SCRUM-28/AC3: a short-lived link to open or download a stored attachment. */
export const fetchAttachmentUrl = (id: string, storagePath: string) =>
  getFromEventService<{ signed_url: string }>(
    `${encodeURIComponent(id)}/attachments/signed-url?storage_path=${encodeURIComponent(storagePath)}`,
  );
