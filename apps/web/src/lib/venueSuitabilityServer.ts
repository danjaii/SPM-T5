import { cookies } from "next/headers";
import { SERVER_VENUE_URL, SESSION_COOKIE } from "./api";
import { suitabilityParams, type SuitabilityQuery, type SuitabilityView } from "./venueSuitability";

// Server-only: reads venue-service with the login cookie via next/headers. Client components must not import this
// file; the browser-safe types and the browser call live in ./venueSuitability.

/**
 * SCRUM-109: the suitability report for a page rendered on the server (the Venue Staff queue detail). Any failure
 * returns null so the page simply shows no report; the check is information, not part of deciding access.
 */
export async function getSuitability(query: SuitabilityQuery): Promise<SuitabilityView | null> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const res = await fetch(`${SERVER_VENUE_URL}/venue-suitability?${suitabilityParams(query).toString()}`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as SuitabilityView) : null;
  } catch {
    return null;
  }
}
