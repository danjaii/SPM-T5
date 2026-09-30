import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { VenueBookingStatus } from "@spm-t5/shared";
import { SERVER_VENUE_URL, SESSION_COOKIE, VENUE_URL, type ApiResult } from "./api";

export interface VenueOption {
  id: string;
  name: string;
  maxCapacity: number | null;
  isActive: boolean;
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

/** Asks venue-service for `path` as the signed-in user; anyone not signed in goes to the sign-in page. */
async function fromVenueService(path: string): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  const res = await fetch(`${SERVER_VENUE_URL}${path}`, {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  return res;
}

/** SCRUM-32: the event form data plus the venues to choose from. */
export async function getVenueBookingForm(
  eventId: string,
): Promise<{ form: VenueBookingFormData; venues: VenueOption[] } | { error: string }> {
  const formRes = await fromVenueService(`/events/${encodeURIComponent(eventId)}/venue-booking-form`);
  const form = await formRes.json();
  if (!formRes.ok) return { error: form.error ?? "We couldn't load this event's venue request form." };

  const venuesRes = await fromVenueService("/venues");
  const venues = await venuesRes.json();
  if (!venuesRes.ok) return { error: venues.error ?? "We couldn't load the venues." };
  return { form, venues };
}

/** SCRUM-33: the signed-in coordinator's venue booking requests. */
export async function getVenueBookings(): Promise<{ bookings: VenueBookingListItem[] } | { error: string }> {
  const res = await fromVenueService("/venue-bookings");
  const data = await res.json();
  return res.ok ? { bookings: data } : { error: data.error ?? "We couldn't load your venue booking requests." };
}

/** SCRUM-33: one request with its reason, suggestion and amendment chain. */
export async function getVenueBooking(id: string): Promise<{ booking: VenueBookingDetailView } | { error: string }> {
  const res = await fromVenueService(`/venue-bookings/${encodeURIComponent(id)}`);
  const data = await res.json();
  return res.ok ? { booking: data } : { error: data.error ?? "We couldn't load this venue booking request." };
}

export interface VenueBookingInputBody {
  eventId: string;
  venueId: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** SCRUM-32: submit a venue booking request from the browser (sends the session cookie). */
export async function submitVenueBooking(body: VenueBookingInputBody): Promise<ApiResult<{ id: string }>> {
  try {
    const res = await fetch(`${VENUE_URL}/venue-bookings`, {
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

/** "PENDING" -> "Pending" */
export const bookingStatusLabel = (status: string | undefined) =>
  status ? status.charAt(0) + status.slice(1).toLowerCase() : "Unknown";
