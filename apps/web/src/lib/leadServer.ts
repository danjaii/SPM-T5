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

/** SCRUM-81: one of the Lead's active coordinators and their workload count (non-closed events). */
export interface LeadCoordinator {
  id: string;
  full_name: string;
  workload: number;
}

/** SCRUM-81: one of a coordinator's non-closed events. */
export interface LeadCoordinatorEvent {
  id: string;
  name: string;
  status: string;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
}

/** SCRUM-81: the Lead's active coordinators with their workload counts. Leads only. */
export async function getLeadCoordinators(): Promise<{ coordinators: LeadCoordinator[] } | { error: string }> {
  const res = await fromEventService("/lead/coordinators");
  const data = await res.json();
  return res.ok ? { coordinators: data } : { error: data.error ?? "We couldn't load your coordinators." };
}

/** SCRUM-81: one coordinator's non-closed events. Refused for a coordinator the Lead doesn't supervise. */
export async function getCoordinatorEvents(id: string): Promise<{ events: LeadCoordinatorEvent[] } | { error: string }> {
  const res = await fromEventService(`/lead/coordinators/${encodeURIComponent(id)}/events`);
  const data = await res.json();
  return res.ok ? { events: data } : { error: data.error ?? "We couldn't load this coordinator's events." };
}

/** SCRUM-78 / SCRUM-79: an event as the assign and reassign steps show it. */
export type LeadEvent = LeadQueueItem & { status: string };

/** SCRUM-78: what the assign step shows: the event, whether it can be assigned, and the Lead's eligible coordinators. */
export interface LeadAssignment {
  event: LeadEvent;
  canAssign: boolean;
  coordinators: LeadCoordinator[];
}

/** SCRUM-78/AC1: the assign step for one event. Leads only. */
export async function getLeadAssignment(id: string): Promise<{ assignment: LeadAssignment } | { error: string }> {
  const res = await fromEventService(`/lead/events/${encodeURIComponent(id)}/assignment`);
  const data = await res.json();
  return res.ok ? { assignment: data } : { error: data.error ?? "We couldn't load this event request." };
}

/** SCRUM-79: what the reassign step shows: the event, who has it now, whether it can be reassigned, and the other choices. */
export interface LeadReassignment {
  event: LeadEvent;
  current: { id: string; full_name: string | null } | null;
  canReassign: boolean;
  coordinators: LeadCoordinator[];
}

/** SCRUM-79/AC1, AC2: the reassign step for one event. Leads only. */
export async function getLeadReassignment(id: string): Promise<{ reassignment: LeadReassignment } | { error: string }> {
  const res = await fromEventService(`/lead/events/${encodeURIComponent(id)}/reassignment`);
  const data = await res.json();
  return res.ok ? { reassignment: data } : { error: data.error ?? "We couldn't load this event." };
}
