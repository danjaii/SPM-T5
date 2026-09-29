import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { VenueDetails } from "@/components/VenueDetail";
import type { VenueSummary } from "@/components/VenueList";
import { SERVER_VENUE_URL, SESSION_COOKIE } from "./api";

// start
// in this segment, we are basically saying that if user is on venue list page or at the detailed venue page, and they are not logged in, we redirect them
/**
 * Asks venue-service for `path` as the signed-in user. Anyone not signed in is sent to the sign-in page:
 * with no login cookie we don't bother venue-service; if venue-service doesn't recognise the login
 * (e.g. it expired) it answers 401.
 */
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
// end

/** SCRUM-29: loads the venue catalogue from venue-service, as the signed-in user. */
export async function getVenues(): Promise<{ venues: VenueSummary[] } | { error: string }> {
  const res = await fromVenueService("/venues");

  // SCRUM-29 AC4: not allowed (or another problem) → pass venue-service's message on for the page to show
  const data = await res.json();
  return res.ok ? { venues: data } : { error: data.error ?? "We couldn't load the venue catalogue." };
}

/** SCRUM-29 AC2: loads one venue's full details from venue-service, as the signed-in user. */
export async function getVenue(id: string): Promise<{ venue: VenueDetails } | { error: string }> {
  const res = await fromVenueService(`/venues/${encodeURIComponent(id)}`);

  // SCRUM-29 AC4 + unknown venue: pass venue-service's message on for the page to show
  const data = await res.json();
  return res.ok ? { venue: data } : { error: data.error ?? "We couldn't load this venue." };
}
