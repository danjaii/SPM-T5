import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { SERVER_VENUE_URL, SESSION_COOKIE } from "./api";
import type { QueueDetailView, QueueItemView } from "./bookingQueue";
import { sgtDate, type ScheduleItemView, type VenueBlockView } from "./venueStaffDashboard";

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

/** SCRUM-163: this week's approved bookings, earliest first (the Venue Staff dashboard's schedule). */
export async function getVenueSchedule(): Promise<ScheduleItemView[] | undefined> {
  try {
    const res = await fromVenueService("/booking-queue/schedule");
    return res.ok ? ((await res.json()) as ScheduleItemView[]) : undefined;
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return undefined;
  }
}

interface CalendarResponse {
  venues: { name: string; periods: { kind: string; start: string; end: string; reason_label?: string }[] }[];
}

/** SCRUM-163: the unavailability blocks running now or in the next 30 days, from the venue calendar. */
export async function getVenueBlocks(now = new Date()): Promise<VenueBlockView[] | undefined> {
  try {
    const to = new Date(now.getTime() + 30 * 86_400_000);
    const res = await fromVenueService(`/venue-calendar?from=${sgtDate(now)}&to=${sgtDate(to)}`);
    if (!res.ok) return undefined;
    const { venues } = (await res.json()) as CalendarResponse;
    return venues.flatMap((v) =>
      v.periods.filter((p) => p.kind === "block").map((p) => ({ venueName: v.name, start: p.start, end: p.end, reasonLabel: p.reason_label ?? "Unavailable" })),
    );
  } catch (e) {
    if (isRedirectError(e)) throw e;
    return undefined;
  }
}
