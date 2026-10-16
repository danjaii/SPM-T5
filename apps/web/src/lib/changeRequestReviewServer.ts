import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";
import type { ChangeRequestReviewView } from "./changeRequestReview";

// Server-only: reads event-service with the login cookie via next/headers (SCRUM-67). Client components must not import
// this file; the browser-safe types and calls live in ./changeRequestReview.

/** AC2, AC7: the review, or event-service's refusal in its own words (only the event's coordinator may review). */
export async function getChangeRequestReview(id: string): Promise<{ review: ChangeRequestReviewView } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_EVENT_URL}/change-requests/${encodeURIComponent(id)}`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't reach the server. Please try again." };
  }
  if (res.status === 401) redirect("/login");
  const body = await res.json();
  return res.ok ? { review: body } : { error: body.error ?? "We couldn't load the change request." };
}
