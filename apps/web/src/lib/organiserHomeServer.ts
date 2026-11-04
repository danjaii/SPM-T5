import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";
import type { OrganiserHomeEvent } from "./organiserHome";

// Server-only: reads event-service with the session cookie via next/headers. The browser-safe types live in ./organiserHome.

/** SCRUM-159: the signed-in organiser's events for the Home page, or event-service's reason it could not list them. */
export async function getOrganiserHome(): Promise<{ events: OrganiserHomeEvent[] } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_EVENT_URL}/events/my-requests/home`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't reach the server. Please try again." };
  }
  if (res.status === 401) redirect("/login");
  const data = await res.json().catch(() => undefined);
  if (res.ok && Array.isArray(data)) return { events: data as OrganiserHomeEvent[] };
  return { error: data?.error ?? "We couldn't load your events. Please try again." };
}
