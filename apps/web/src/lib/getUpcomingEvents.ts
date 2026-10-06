import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";

/** One card in the attendee's List of events, as event-service's GET /events/upcoming sends it. */
export interface UpcomingEvent {
  id: string;
  name: string;
  start_at: string;
  end_at: string | null;
  venue: { name: string | null; address: string | null };
  /** SCRUM-71/AC7: event-service picks the one label (by priority); "open" means no label. */
  availability: "cancelled" | "full" | "closed" | "open";
  /** SCRUM-71/AC10: the attendee's own active registration; null when they have none (or it was withdrawn/rejected). */
  my_registration: "confirmed" | "pending" | null;
}

/** SCRUM-71: loads the attendee's List of events from event-service, as the signed-in user. */
export async function getUpcomingEvents(): Promise<{ events: UpcomingEvent[] } | { error: string }> {
  // SCRUM-71/AC6: only for signed-in users; anyone else goes to the sign-in page
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  const res = await fetch(`${SERVER_EVENT_URL}/events/upcoming`, {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    cache: "no-store",
  });
  // SCRUM-71/AC6: event-service no longer accepts the login (e.g. it expired)
  if (res.status === 401) redirect("/login");

  // SCRUM-71/AC11: couldn't load the list: pass event-service's message on, so the page doesn't claim it's empty
  const data = await res.json();
  return res.ok ? { events: data } : { error: data.error ?? "We couldn't load upcoming events. Please try again." };
}
