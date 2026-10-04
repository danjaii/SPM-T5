import type { VenueBookingStatus } from "@spm-t5/shared";
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
}

/** POSTs JSON to venue-service from the browser, sending the session cookie. */
async function postToVenueService(path: string, body?: unknown): Promise<ApiResult<{ id: string }>> {
  try {
    const res = await fetch(`${VENUE_URL}${path}`, {
      method: "POST",
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

/** SCRUM-35: withdraw a pending request. */
export const withdrawVenueBooking = (id: string) =>
  postToVenueService(`/venue-bookings/${encodeURIComponent(id)}/withdraw`);

/** SCRUM-60: amend a rejected request into a new one (the event comes from the rejected request). */
export const amendVenueBooking = (id: string, body: Omit<VenueBookingInputBody, "eventId">) =>
  postToVenueService(`/venue-bookings/${encodeURIComponent(id)}/amend`, body);

/** SCRUM-59: accept the suggested alternative on a rejected request. */
export const acceptVenueSuggestion = (id: string) =>
  postToVenueService(`/venue-bookings/${encodeURIComponent(id)}/accept-suggestion`);

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
