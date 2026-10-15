// Browser-safe types and the call for requesting equipment (SCRUM-86). The server-side fetches of the form and the
// event's requests live in ./equipmentRequestsServer.

import type { EquipmentRequestStatus } from "@spm-t5/shared";
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
  /** SCRUM-102/AC7: for a Released one, why its venue booking was cancelled. */
  releasedReason: string | null;
}

/** GET /events/:id/equipment-requests: the event's requests, and whether the viewer may add one (AC6, AC7). */
export interface EventEquipmentRequestsView {
  requests: EquipmentRequestView[];
  canCreate: boolean;
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
