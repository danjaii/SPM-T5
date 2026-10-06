import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";
import type { ChangeRequestView, EventDetailView } from "./events";

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
