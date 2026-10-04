import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_VENUE_URL, SESSION_COOKIE } from "./api";
import type { QueueDetailView, QueueItemView } from "./bookingQueue";

// Server-only: reads venue-service with the session cookie via next/headers. Client components must not
// import this file; the browser-safe types live in ./bookingQueue.

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

/** SCRUM-37: the pending requests, earliest submission first. Venue Staff only (anyone else gets the 403 message). */
export async function getBookingQueue(): Promise<{ requests: QueueItemView[] } | { error: string }> {
  const res = await fromVenueService("/booking-queue");
  const data = await res.json();
  return res.ok ? { requests: data } : { error: data.error ?? "We couldn't load the pending booking requests." };
}

/** SCRUM-37: one request with its status and, once decided, who decided it. */
export async function getQueuedBooking(id: string): Promise<{ booking: QueueDetailView } | { error: string }> {
  const res = await fromVenueService(`/booking-queue/${encodeURIComponent(id)}`);
  const data = await res.json();
  return res.ok ? { booking: data } : { error: data.error ?? "We couldn't load this venue booking request." };
}
