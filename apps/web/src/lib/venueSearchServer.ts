import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_VENUE_URL, SESSION_COOKIE } from "./api";
import type { VenueSearchOptions } from "./venueSearch";

// Server-only: reads venue-service with the login cookie via next/headers. Client components must not import
// this file; the browser-safe types live in ./venueSearch.

/**
 * SCRUM-65: the layouts and facilities the search form offers. Anyone not signed in goes to the sign-in page;
 * a role that may not search (anyone but coordinators and venue staff) gets the service's 403 message.
 */
export async function getVenueSearchOptions(): Promise<{ options: VenueSearchOptions } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_VENUE_URL}/venues/search-options`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't reach the venue service. Please try again." };
  }
  if (res.status === 401) redirect("/login");

  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: (body as { error?: string }).error ?? "Something went wrong. Please try again." };
  return { options: body as VenueSearchOptions };
}
