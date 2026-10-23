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
  const data = await res.json().catch(() => ({}));
  return res.ok ? { requests: data as MyEventRequest[] } : { error: data.error ?? "We couldn't load your event requests. Please try again." };
}
