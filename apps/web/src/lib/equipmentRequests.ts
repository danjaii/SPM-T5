// Browser-safe types and the calls for requesting equipment (SCRUM-86) and reviewing requests (SCRUM-87). The
// server-side fetches live in ./equipmentRequestsServer.

import type { EquipmentReadiness, EquipmentRequestReviewStatus, EquipmentRequestStatus, SentBackNote } from "@spm-t5/shared";
import { EQUIPMENT_URL, type ApiResult } from "./api";

/** GET /events/:id/equipment-request-form: what the request form offers. Venue dates and times are Singapore time. */
export interface EquipmentRequestFormData {
  event: { id: string; name: string };
  equipment: Array<{ id: string; label: string }>;
  venues: Array<{ id: string; venueName: string; date: string; startTime: string; endTime: string }>;
}

/** SCRUM-86/AC2: one request as the event shows it. */
export interface EquipmentRequestView {
  id: string;
  equipment: string;
  quantity: number;
  venueName: string | null;
  /** SCRUM-102: the venue booking it is for (null for an older request with no venue). */
  venueBookingId: string | null;
  notes: string | null;
  status: EquipmentRequestStatus;
  statusLabel: string;
  /** SCRUM-87/AC5: why it cannot be fulfilled, once Technical Support Staff said so. */
  reason: string | null;
  /** SCRUM-102/AC7: for a Released one, why its venue booking was cancelled. */
  releasedReason: string | null;
  /** SCRUM-113/AC2: sent back to Submitted for review after an important event change. */
  sentBackForReview?: boolean;
}

/** GET /events/:id/equipment-requests: the event's requests, and whether the viewer may add one (AC6, AC7). */
export interface EventEquipmentRequestsView {
  requests: EquipmentRequestView[];
  canCreate: boolean;
  /** SCRUM-87/AC6: Complete when every request is Arranged; null when nothing has been requested. */
  readiness: EquipmentReadiness | null;
  readinessLabel: string | null;
}

/** POST /events/:id/equipment-requests: the form's fields exactly as typed; equipment-service checks them again. */
export interface EquipmentRequestBody {
  equipmentId: string;
  quantity: string;
  venueBookingId: string;
  notes: string;
}

/** Asks equipment-service from the browser to save the request, sending the login cookie. */
export async function submitEquipmentRequest(
  eventId: string,
  body: EquipmentRequestBody,
): Promise<ApiResult<EquipmentRequestView>> {
  try {
    const res = await fetch(`${EQUIPMENT_URL}/events/${encodeURIComponent(eventId)}/equipment-requests`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return {
      ok: false,
      data: { error: "We couldn't reach the server. Please try again." } as ApiResult<EquipmentRequestView>["data"],
    };
  }
}

/** SCRUM-87/AC1: GET /equipment-requests, one row of the queue. The event date is Singapore time. */
export interface EquipmentQueueItemView {
  id: string;
  eventId: string;
  eventName: string;
  eventDate: string;
  venueName: string | null;
  equipment: string;
  quantity: number;
  status: EquipmentRequestStatus;
  statusLabel: string;
  /** SCRUM-113/AC3: what changed on the event when it was sent back for review; null (or missing) otherwise. */
  sentBack?: SentBackNote | null;
}

/** SCRUM-87/AC3: GET /equipment-requests/:id, one request in full. Times are Singapore time. */
export interface EquipmentRequestDetailView extends EquipmentQueueItemView {
  startTime: string;
  endTime: string;
  notes: string | null;
  reason: string | null;
  /** AC4: whether its status can still be changed. */
  canReview: boolean;
}

/** PATCH /equipment-requests/:id: the new status, and the reason for Cannot Fulfil. */
export interface EquipmentReviewBody {
  status: EquipmentRequestReviewStatus;
  reason: string;
}

/** SCRUM-87/AC4, AC5: asks equipment-service from the browser to change a request's status, sending the login cookie. */
export async function reviewEquipmentRequest(
  id: string,
  body: EquipmentReviewBody,
): Promise<ApiResult<EquipmentRequestDetailView>> {
  try {
    const res = await fetch(`${EQUIPMENT_URL}/equipment-requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return {
      ok: false,
      data: { error: "We couldn't reach the server. Please try again." } as ApiResult<EquipmentRequestDetailView>["data"],
    };
  }
}
