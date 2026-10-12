import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_VENUE_URL, SESSION_COOKIE } from "./api";
import type {
  EventVenueBookingView,
  VenueBookingDetailView,
  VenueBookingFormData,
  VenueBookingListItem,
  VenueOption,
} from "./venueBookings";

// Server-only: reads venue-service with the session cookie via next/headers. Client components must not
// import this file; the browser-safe types, POST helpers and bookingActions() live in ./venueBookings.

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


/**
 * SCRUM-38: the approved venue booking for an event, or null. Only the event's assigned Coordinator is
 * answered (anyone else gets 403), so any failure just means "show nothing" rather than an error.
 */
export async function getApprovedVenueBooking(eventId: string): Promise<EventVenueBookingView | null> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const res = await fetch(`${SERVER_VENUE_URL}/events/${encodeURIComponent(eventId)}/venue-booking`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as EventVenueBookingView | null) : null;
  } catch {
    return null;
  }
}
