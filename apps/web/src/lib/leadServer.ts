import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";

// Server-only: reads event-service's Lead routes with the session cookie via next/headers. Client components must not
// import this file.

/** SCRUM-77: one event request in the unassigned queue, as event-service returns it. */
export interface LeadQueueItem {
  id: string;
  name: string;
  organiser_name: string | null;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
  submitted_at: string | null;
}

/** Asks event-service for `path` as the signed-in user; anyone not signed in goes to the sign-in page. */
async function fromEventService(path: string): Promise<Response> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  const res = await fetch(`${SERVER_EVENT_URL}${path}`, {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  return res;
}

/** SCRUM-77: the requests waiting for a coordinator, oldest submission first. Leads only (anyone else gets the 403 message). */
export async function getLeadQueue(): Promise<{ requests: LeadQueueItem[] } | { error: string }> {
  const res = await fromEventService("/lead/queue");
  const data = await res.json();
  return res.ok ? { requests: data } : { error: data.error ?? "We couldn't load the unassigned event requests." };
}
