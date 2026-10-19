import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EQUIPMENT_URL, SESSION_COOKIE } from "./api";
import type { EventTechnicalAssignmentsView } from "./technicalAssignments";

// Server-only: reads equipment-service with the login cookie via next/headers (SCRUM-20). Client components must not
// import this file; the browser-safe types and calls live in ./technicalAssignments.

async function fetchAssignments(eventId: string, token: string): Promise<Response> {
  return fetch(`${SERVER_EQUIPMENT_URL}/events/${encodeURIComponent(eventId)}/technical-assignments`, {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    cache: "no-store",
  });
}

/**
 * AC5: the event's on-site assignments, for the event page. null when the viewer may not see them (only the event's
 * coordinator may) or the service can't be reached, so the page leaves the section out.
 */
export async function getEventTechnicalAssignments(eventId: string): Promise<EventTechnicalAssignmentsView | null> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const res = await fetchAssignments(eventId, token);
    return res.ok ? ((await res.json()) as EventTechnicalAssignmentsView) : null;
  } catch {
    return null;
  }
}

/** AC1, AC2: what the assign and change pages need; equipment-service's refusal is shown instead of the form. */
export async function getTechnicalAssignmentForm(eventId: string): Promise<{ data: EventTechnicalAssignmentsView } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetchAssignments(eventId, token);
  } catch {
    return { error: "We couldn't reach the server. Please try again." };
  }
  if (res.status === 401) redirect("/login");
  const body = await res.json();
  return res.ok ? { data: body } : { error: body.error ?? "We couldn't load the on-site assignments." };
}
