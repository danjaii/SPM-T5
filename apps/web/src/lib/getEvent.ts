import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";
import type { ChangeRequestView, EventDetailView, ReviewDecision } from "./events";

/**
 * Loads an event and its request details (SCRUM-23) from event-service, as the signed-in user. event-service
 * decides who may see it (SCRUM-6/7) and whether they may change its status (SCRUM-8).
 */
export async function getEvent(id: string): Promise<{ event: EventDetailView } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  const res = await fetch(`${SERVER_EVENT_URL}/events/${encodeURIComponent(id)}`, {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");

  const data = await res.json();
  return res.ok ? { event: data as EventDetailView } : { error: data.error ?? "We couldn't load this event." };
}

/** SCRUM-66/AC7: the event's change requests, newest first, as the signed-in user. An empty list when they can't be loaded. */
export async function getChangeRequests(id: string): Promise<ChangeRequestView[]> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  const res = await fetch(`${SERVER_EVENT_URL}/events/${encodeURIComponent(id)}/change-requests`, {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  return res.ok ? ((await res.json()) as ChangeRequestView[]) : [];
}

/**
 * SCRUM-44: the review outcome for the event page. event-service applies the same access rules as getEvent
 * (AC6). Returns null when there is no decision yet (AC5) or it can't be loaded — the page then simply
 * shows no outcome rather than a wrong one.
 */
export async function getEventOutcome(id: string): Promise<ReviewDecision | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  try {
    const res = await fetch(`${SERVER_EVENT_URL}/events/${encodeURIComponent(id)}/outcome`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { decision: ReviewDecision | null };
    return data.decision;
  } catch {
    return null;
  }
}
