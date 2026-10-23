import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";
import type { MyEventRequest } from "./myEventRequests";

// Server-only: reads event-service with the session cookie via next/headers. The browser-safe type lives in ./myEventRequests.

/** SCRUM-52/AC1: the signed-in organiser's event requests, or event-service's reason it could not list them. */
export async function getMyEventRequests(): Promise<{ requests: MyEventRequest[] } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_EVENT_URL}/events/my-requests`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't reach the server. Please try again." };
  }
  if (res.status === 401) redirect("/login");
  // A body that is not JSON, or a 200 that is not a list, is a failed load: the page maps over `requests`
  const data = await res.json().catch(() => undefined);
  if (res.ok && Array.isArray(data)) return { requests: data as MyEventRequest[] };
  return { error: data?.error ?? "We couldn't load your event requests. Please try again." };
}
