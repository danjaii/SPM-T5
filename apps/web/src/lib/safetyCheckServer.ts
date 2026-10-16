import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";

// Server-only: reads event-service's safety check routes with the session cookie via next/headers. Client components
// must not import this file.

/** SCRUM-99/AC2: one event waiting for a safety check, as event-service returns it. */
export interface SafetyQueueItem {
  id: string;
  name: string;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
  venue_names: string[];
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

/** SCRUM-99/AC2: the events waiting for a safety check, soonest first. Safety Officers only. */
export async function getSafetyQueue(): Promise<{ events: SafetyQueueItem[] } | { error: string }> {
  const res = await fromEventService("/safety-checks");
  const data = await res.json();
  return res.ok ? { events: data } : { error: data.error ?? "We couldn't load the events waiting for a safety check." };
}

/** SCRUM-99/AC3: one venue the event is booked into, with what the safety check needs to know about it. */
export interface SafetyVenue {
  name: string;
  start: string;
  end: string;
  max_capacity: number;
  /** How many the venue holds in the event's layout; null if the venue doesn't list that layout. */
  layout_capacity: number | null;
  emergency_access: string | null;
  accessibility_notes: string | null;
  restrictions: string | null;
  unavailability: { reason: string; notes: string | null; start: string; end: string }[];
}

/** SCRUM-99/AC8: a recorded safety decision. */
export interface SafetyDecisionRecord {
  decision: string;
  reason: string | null;
  officer_name: string;
  decided_at: string;
}

/** SCRUM-99/AC3: an event's safety information, as event-service returns it. */
export interface SafetyCheckDetails {
  id: string;
  name: string;
  status: string;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
  layout: string | null;
  accessibility_requirements: string | null;
  venues: SafetyVenue[];
  equipment: { name: string; quantity: number; placement: string | null }[];
  decisions: SafetyDecisionRecord[];
}

/** SCRUM-99/AC3: one event's safety information. Safety Officers only. */
export async function getSafetyCheck(id: string): Promise<{ details: SafetyCheckDetails } | { error: string }> {
  const res = await fromEventService(`/safety-checks/${encodeURIComponent(id)}`);
  const data = await res.json();
  return res.ok ? { details: data } : { error: data.error ?? "We couldn't load this event's safety information." };
}
