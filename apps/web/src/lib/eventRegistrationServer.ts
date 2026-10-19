import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";
import type { EventRegistration, ManagedEvent, MyRegistration, RegistrationFormData } from "./eventRegistration";

// Server-only: reads event-service with the session cookie via next/headers. Client components must not
// import this file; the browser-safe types and the POST helper live in ./eventRegistration.

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

/** SCRUM-83/AC7, AC8: the registration form's event details and prefilled fields. */
export async function getRegistrationForm(eventId: string): Promise<{ data: RegistrationFormData } | { error: string }> {
  const res = await fromEventService(`/events/${encodeURIComponent(eventId)}/registration-form`);
  const data = await res.json();
  return res.ok ? { data } : { error: data.error ?? "We couldn't load this registration form." };
}

/** SCRUM-83/AC15: the signed-in attendee's registrations, earlier ones included. */
export async function getMyRegistrations(): Promise<{ registrations: MyRegistration[] } | { error: string }> {
  const res = await fromEventService("/events/my-registrations");
  const data = await res.json();
  return res.ok ? { registrations: data } : { error: data.error ?? "We couldn't load your registrations. Please try again." };
}

/** SCRUM-83/AC15: an event's registrations, for its organiser and assigned coordinator (RLS decides which rows). */
export async function getEventRegistrations(
  eventId: string,
): Promise<{ registrations: EventRegistration[] } | { error: string }> {
  const res = await fromEventService(`/events/${encodeURIComponent(eventId)}/registrations`);
  const data = await res.json();
  return res.ok
    ? { registrations: data }
    : { error: data.error ?? "We couldn't load this event's registrations. Please try again." };
}

/** SCRUM-74/AC1: the events whose registrations the signed-in organiser or coordinator can view. */
export async function getManagedEvents(): Promise<{ events: ManagedEvent[] } | { error: string }> {
  const res = await fromEventService("/events/managed");
  const data = await res.json();
  return res.ok ? { events: data } : { error: data.error ?? "We couldn't load your events. Please try again." };
}
