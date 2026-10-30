import type { RegistrationForm, RegistrationStatus } from "@spm-t5/shared";
import { EVENT_URL, type ApiResult } from "./api";
import type { UpcomingEvent } from "./getUpcomingEvents";

// Browser-safe types and helpers for SCRUM-83 (Register for an event).

/** SCRUM-83: what event-service's GET /events/:id/registration-form sends. */
export interface RegistrationFormData {
  /** AC7: the event as a List of events card shows it (SCRUM-71), plus availability and the attendee's own status. */
  event: UpcomingEvent;
  /** AC8, AC9: the attendee's details from their profile; phone is "" when the profile has none. */
  prefill: { name: string; email: string; phone: string };
}

/** SCRUM-83: a registration's status in the words the attendee sees, as event-service sends it. */
export type { RegistrationStatus };

export const STATUS_LABELS: Record<RegistrationStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** SCRUM-169/AC2: what an attendee sees before registering for a full event. */
export const FULL_EVENT_NOTE = "This event is full. You can still register, and the organiser will decide.";

/** SCRUM-83/AC15: one of the attendee's registrations, as GET /events/my-registrations sends it. */
export interface MyRegistration {
  id: string;
  status: RegistrationStatus;
  registered_at: string;
  /** SCRUM-73/AC2, AC5: whether it can be withdrawn now (Pending or Confirmed, and the event hasn't started or been cancelled). */
  can_withdraw: boolean;
  /** SCRUM-72/AC4: venue is the event's location (null name and address while it is unknown). */
  event: {
    id: string;
    name: string;
    start_at: string;
    end_at: string | null;
    venue: { name: string | null; address: string | null };
  };
}

/** SCRUM-83/AC15: one row of an event's registrations, as GET /events/:id/registrations sends it. */
export interface EventRegistration {
  id: string;
  status: RegistrationStatus;
  registered_at: string;
  /** What the attendee submitted on the form. */
  name: string;
  email: string;
  phone: string;
}

/** SCRUM-74/AC1, AC3: one of the events whose registrations the caller can view, as GET /events/managed sends it. */
export interface ManagedEvent {
  id: string;
  name: string;
  status: string;
  start_at: string | null;
  registration_capacity: number | null;
  /** SCRUM-169/AC3: whether the caller can confirm or decline Pending registrations: the organiser, not a coordinator. */
  can_decide: boolean;
}

/** SCRUM-74/AC6: the summary above an event's registrations. */
export interface RegistrationSummary {
  total: number;
  byStatus: Record<RegistrationStatus, number>;
  /** SCRUM-74/AC7: capacity minus Confirmed registrations (Pending, Rejected and Withdrawn don't use a slot). */
  slotsRemaining: number | null;
}

/** SCRUM-74/AC6: totals an event's registrations by status. */
export function registrationSummary(registrations: EventRegistration[], capacity: number | null): RegistrationSummary {
  const byStatus: Record<RegistrationStatus, number> = { pending: 0, confirmed: 0, rejected: 0, withdrawn: 0 };
  for (const r of registrations) byStatus[r.status] += 1;
  // SCRUM-74/AC6: no capacity means no limit, so there is no figure to show
  const slotsRemaining = capacity === null ? null : capacity - byStatus.confirmed;
  return { total: registrations.length, byStatus, slotsRemaining };
}

/** SCRUM-83/AC12, AC14: registers the signed-in attendee for an event, from the browser, sending the session cookie. */
export async function submitRegistration(
  eventId: string,
  form: RegistrationForm,
): Promise<ApiResult<{ event_name: string; status: RegistrationStatus }>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/${encodeURIComponent(eventId)}/registrations`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}

/** SCRUM-73/AC6: withdraws one of the signed-in attendee's registrations, from the browser, sending the session cookie. */
export async function withdrawRegistration(registrationId: string): Promise<ApiResult<{ status: RegistrationStatus }>> {
  const res = await fetch(`${EVENT_URL}/events/my-registrations/${encodeURIComponent(registrationId)}/withdraw`, {
    method: "POST",
    credentials: "include",
  });
  return { ok: res.ok, data: await res.json() };
}

/** SCRUM-169/AC3: the organiser confirms or declines a Pending registration, from the browser, sending the session cookie. */
export async function decideRegistration(
  eventId: string,
  registrationId: string,
  decision: "confirm" | "decline",
): Promise<ApiResult<{ status: RegistrationStatus }>> {
  try {
    const res = await fetch(
      `${EVENT_URL}/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(registrationId)}/decision`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      },
    );
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}
