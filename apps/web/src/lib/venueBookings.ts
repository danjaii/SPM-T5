import type { VenueBookingStatus } from "@spm-t5/shared";
import type { EquipmentRequestView } from "./equipmentRequests";
import { VENUE_URL, type ApiResult } from "./api";

export interface VenueOption {
  id: string;
  name: string;
  /** As the venue catalogue (SCRUM-29, GET /venues) returns it. */
  max_capacity: number | null;
}

/** GET /events/:id/venue-booking-form (32-S1): the event's own details, pre-filled and read-only in the form. */
export interface VenueBookingFormData {
  eventId: string;
  eventName: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  expectedAttendance: number | null;
  venueRequirements: string | null;
  accessibilityNeeds: string | null;
}

/** A row in the coordinator's list (SCRUM-33). */
export interface VenueBookingListItem {
  id: string;
  eventId: string;
  eventName: string;
  venueId: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: VenueBookingStatus | undefined;
  /** Only for APPROVED and REJECTED. */
  decidedAt: string | null;
  submittedAt: string;
}

export interface VenueBookingChainItem extends VenueBookingListItem {
  rejectionReason: string | null;
}

export interface VenueBookingDetailView extends VenueBookingListItem {
  expectedAttendance: number | null;
  venueRequirements: string | null;
  accessibilityNeeds: string | null;
  rejectionReason: string | null;
  suggestion: { venueId: string; venueName: string; date: string; startTime: string; endTime: string } | null;
  amendsRequestId: string | null;
  chain: VenueBookingChainItem[];
}

export interface VenueBookingInputBody {
  eventId: string;
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
  /** SCRUM-98/AC2: this venue booking's own numbers; left out means "use the event's". */
  expectedAttendance?: number;
  venueRequirements?: string;
}

/** Sends JSON to venue-service from the browser (POST, or PATCH for SCRUM-102's change), with the session cookie. */
async function postToVenueService(path: string, body?: unknown, method: "POST" | "PATCH" = "POST"): Promise<ApiResult<{ id: string }>> {
  try {
    const res = await fetch(`${VENUE_URL}${path}`, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}

/** SCRUM-32: submit a venue booking request. */
export const submitVenueBooking = (body: VenueBookingInputBody) => postToVenueService("/venue-bookings", body);

/** SCRUM-102/AC1: a venue booking's new date, times and own numbers; its venue never changes. Blank numbers are left out. */
export interface VenueBookingChangeBody {
  date: string;
  startTime: string;
  endTime: string;
  expectedAttendance?: number;
  venueRequirements?: string;
}

/** SCRUM-102/AC1: change one pending or approved venue booking; it goes back to venue staff. */
export const changeVenueBooking = (id: string, body: VenueBookingChangeBody) =>
  postToVenueService(`/venue-bookings/${encodeURIComponent(id)}`, body, "PATCH");

/** SCRUM-102/AC2, AC7: cancel one pending or approved venue booking with a reason; its equipment is released with it. */
export const cancelVenueBooking = (id: string, reason: string) =>
  postToVenueService(`/venue-bookings/${encodeURIComponent(id)}/cancel`, { reason });

/** SCRUM-102: only a PENDING or APPROVED venue booking can be changed or cancelled (the server checks again: NOT_ACTIVE). */
export const isChangeableVenueBooking = (status: VenueBookingStatus | undefined) => status === "PENDING" || status === "APPROVED";

/** SCRUM-102/AC7, AC8: the equipment requested for this venue booking that cancelling would release or changing would move. */
export const equipmentFor = (requests: EquipmentRequestView[], venueBookingId: string) =>
  requests.filter((r) => r.venueBookingId === venueBookingId && r.status !== "RELEASED");

/** SCRUM-35: withdraw a pending request. */
export const withdrawVenueBooking = (id: string) =>
  postToVenueService(`/venue-bookings/${encodeURIComponent(id)}/withdraw`);

/** SCRUM-60: amend a rejected request into a new one (the event comes from the rejected request). */
export const amendVenueBooking = (id: string, body: Omit<VenueBookingInputBody, "eventId">) =>
  postToVenueService(`/venue-bookings/${encodeURIComponent(id)}/amend`, body);

/** SCRUM-59: accept the suggested alternative on a rejected request. */
export const acceptVenueSuggestion = (id: string) =>
  postToVenueService(`/venue-bookings/${encodeURIComponent(id)}/accept-suggestion`);

/** SCRUM-38: Venue Staff approve a pending request. */
export const approveVenueBooking = (id: string) =>
  postToVenueService(`/venue-bookings/${encodeURIComponent(id)}/approve`);

/** SCRUM-39: Venue Staff reject a pending request; the reason is required (1 to 500 characters). */
export const rejectVenueBooking = (id: string, reason: string) =>
  postToVenueService(`/venue-bookings/${encodeURIComponent(id)}/reject`, { reason });

/**
 * GET /events/:id/venue-bookings (SCRUM-98/AC5): one venue booking of the event, as its assigned Coordinator sees it.
 * Replaces SCRUM-38's single approved venue (38-S4): an approved one is in this list too.
 */
export interface EventVenueBookingItem extends VenueBookingChainItem {
  /** SCRUM-102: only for a CANCELLED one. */
  cancellationReason: string | null;
  expectedAttendance: number | null;
  venueRequirements: string | null;
  /** More people expected than the venue holds: a warning, never a refusal. */
  exceedsCapacity: boolean;
}

/**
 * Which decisions Venue Staff are offered (38-S2). Only a PENDING request can be decided; the server
 * enforces this again, so a stale screen just gets a NOT_PENDING refusal.
 */
export function decisionActions(status: VenueBookingStatus | undefined) {
  const pending = status === "PENDING";
  return { approve: pending, reject: pending };
}

/**
 * Which actions the detail screen offers (35-S2, 60-S4, 59-S4). Only a PENDING request can be
 * withdrawn; only a REJECTED one can be amended, and only while the event has no other active
 * request; accepting also needs a suggestion. The server enforces all of this again.
 */
export function bookingActions(booking: Pick<VenueBookingDetailView, "id" | "status" | "suggestion" | "chain">) {
  const otherActive = booking.chain.some(
    (c) => c.id !== booking.id && (c.status === "PENDING" || c.status === "APPROVED"),
  );
  const rejected = booking.status === "REJECTED" && !otherActive;
  return {
    withdraw: booking.status === "PENDING",
    amend: rejected,
    acceptSuggestion: rejected && booking.suggestion !== null,
  };
}

/** "PENDING" -> "Pending" */
export const bookingStatusLabel = (status: string | undefined) =>
  status ? status.charAt(0) + status.slice(1).toLowerCase() : "Unknown";
