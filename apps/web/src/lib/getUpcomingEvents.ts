import { cookies } from "next/headers";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";

/** One card in the attendee's List of events, as event-service's GET /events/upcoming sends it. */
export interface UpcomingEvent {
  id: string;
  name: string;
  start_at: string;
  end_at: string | null;
  venue: { name: string | null; address: string | null };
}

/** SCRUM-71: loads the attendee's List of events from event-service, as the signed-in user. */
export async function getUpcomingEvents(): Promise<{ events: UpcomingEvent[] }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";

  const res = await fetch(`${SERVER_EVENT_URL}/events/upcoming`, {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    cache: "no-store",
  });
  return { events: await res.json() };
}
