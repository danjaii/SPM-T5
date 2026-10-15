import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_VENUE_URL, SESSION_COOKIE } from "./api";
import type { VenueAvailabilityData } from "./venueAvailability";

// Server-only: reads venue-service with the login cookie via next/headers. Client components must not import
// this file; the browser-safe types live in ./venueAvailability.

/**
 * SCRUM-103: what occupies a venue on one day, setup and turnaround included. Anyone not signed in goes to the
 * sign-in page; a role that may not see venues, or an unknown venue, gets the service's message.
 */
export async function getVenueAvailability(
  venueId: string,
  date: string,
): Promise<{ data: VenueAvailabilityData } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_VENUE_URL}/venues/${encodeURIComponent(venueId)}/availability?date=${encodeURIComponent(date)}`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't reach the venue service. Please try again." };
  }
  if (res.status === 401) redirect("/login");

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const failure = body as { error?: string; fieldErrors?: { date?: string } };
    return { error: failure.fieldErrors?.date ?? failure.error ?? "Something went wrong. Please try again." };
  }
  return { data: body as VenueAvailabilityData };
}
