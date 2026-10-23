// Browser-safe types and the calls for requesting equipment (SCRUM-86), reviewing requests (SCRUM-87) and changing
// them (SCRUM-88). The
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
  /** SCRUM-88/AC1: the catalogue item, so the change form starts on it. */
  equipmentId: string;
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
  /** SCRUM-88/AC1, AC4, AC6: whether the viewer may change it. */
  canEdit: boolean;
  /** SCRUM-88/AC8: who last changed it, and when (Singapore time, "2026-10-15 17:40"); null if never changed. */
  lastChangedBy: string | null;
  lastChangedAt: string | null;
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

/** SCRUM-88/AC1, AC2: asks equipment-service from the browser to save a change, sending the login cookie. */
export async function updateEquipmentRequest(
  eventId: string,
  requestId: string,
  body: EquipmentRequestBody,
): Promise<ApiResult<EquipmentRequestView>> {
  try {
    const res = await fetch(
      `${EQUIPMENT_URL}/events/${encodeURIComponent(eventId)}/equipment-requests/${encodeURIComponent(requestId)}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
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
  /** SCRUM-88/AC2: the coordinator changed it since Technical Support Staff last acted on it. */
  updated: boolean;
  /** SCRUM-113/AC3: what changed on the event when it was sent back for review; null (or missing) otherwise. */
  sentBack?: SentBackNote | null;
}

/** SCRUM-137: an event holding some of the units during the period. */
export interface EquipmentHolderView {
  eventName: string;
  units: number;
}

/** SCRUM-137: why none of an item can be used; equipment-service sends null for working equipment. */
export type OutOfServiceReason = "damaged" | "under_maintenance" | "retired";

/** SCRUM-137/AC1: free units in the request's period against how many it needs, and why the rest are not free. */
export interface RequestAvailabilityView {
  available: number;
  needed: number;
  sufficient: boolean;
  heldBy: EquipmentHolderView[];
  outOfService: OutOfServiceReason | null;
}

/** SCRUM-137: where held units are, as the mock-up words it: "4 with Robotics Meetup, 1 with Film Society". */
export function holdersText(heldBy: EquipmentHolderView[]): string {
  return heldBy.map((h) => `${h.units} with ${h.eventName}`).join(", ");
}

/** SCRUM-87/AC3: GET /equipment-requests/:id, one request in full. Times are Singapore time. */
export interface EquipmentRequestDetailView extends EquipmentQueueItemView {
  /** SCRUM-137/AC1: only while the request can be reviewed; null (or missing) otherwise. */
  availability?: RequestAvailabilityView | null;
  startTime: string;
  endTime: string;
  notes: string | null;
  reason: string | null;
  /** AC4: whether its status can still be changed. */
  canReview: boolean;
  /** SCRUM-88/AC8: who last changed it, and when; null if never changed. */
  lastChangedBy: string | null;
  lastChangedAt: string | null;
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
