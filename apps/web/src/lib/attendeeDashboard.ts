import type { RegistrationStatus } from "@spm-t5/shared";
import type { MyRegistration } from "./eventRegistration";
import type { UpcomingEvent } from "./getUpcomingEvents";
import type { StatusDisplay } from "./status";

// SCRUM-161: the pure rules behind the attendee's Home, kept apart from the fetching so they can be tested alone.

/** AC1: a registration's status in the attendee's words (Pending is "Waitlisted"), each with its own icon so it is never colour alone. */
export const ATTENDEE_STATUS_DISPLAY: Record<RegistrationStatus, StatusDisplay> = {
  confirmed: { tone: "success", icon: "check", label: "Registered" },
  pending: { tone: "info", icon: "hourglass", label: "Waitlisted" },
  rejected: { tone: "danger", icon: "x", label: "Declined" },
  withdrawn: { tone: "neutral", icon: "undo", label: "Withdrawn" },
};

const isActive = (r: MyRegistration) => r.status === "confirmed" || r.status === "pending";
const byStart = (a: MyRegistration, b: MyRegistration) => Date.parse(a.event.start_at) - Date.parse(b.event.start_at);

/** AC1, AC2: the registrations that still hold or wait for a place, soonest event first; and the withdrawn or declined ones, below. */
export function splitRegistrations(registrations: MyRegistration[]): { upcoming: MyRegistration[]; closed: MyRegistration[] } {
  return {
    upcoming: registrations.filter(isActive).sort(byStart),
    closed: registrations.filter((r) => !isActive(r)).sort(byStart),
  };
}

/** The first name of whoever is signed in, for "Welcome back, Amir"; the greeting alone when the name is unknown. */
export function welcome(fullName: string | undefined): string {
  const first = fullName?.trim().split(/\s+/)[0];
  return first ? `Welcome back, ${first}` : "Welcome back";
}

/** The line under the greeting; undefined registrations (they could not be loaded) say so rather than claiming none. */
export function homeSummary(registrations: MyRegistration[] | undefined): string {
  if (!registrations) return "Your registrations could not be loaded.";
  const n = splitRegistrations(registrations).upcoming.length;
  if (n === 0) return "You are not registered for any upcoming events yet.";
  return `You are registered for ${n} upcoming ${n === 1 ? "event" : "events"}.`;
}

/** Events the attendee can still register for: open or full (a full one takes a waitlisted registration), not yet registered. */
export function openForRegistration(events: UpcomingEvent[], limit = 4): UpcomingEvent[] {
  return events.filter((e) => e.can_register && !e.my_registration).slice(0, limit);
}

/** The figures above the lists: places held, places waited for, and the next event. */
export function attendeeKpis(registrations: MyRegistration[]): { label: string; value: string | number; note: string }[] {
  const { upcoming } = splitRegistrations(registrations);
  const next = upcoming[0];
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Singapore", day: "numeric", month: "short" });
  return [
    { label: "Registered", value: upcoming.filter((r) => r.status === "confirmed").length, note: "Upcoming events" },
    { label: "Waitlisted", value: upcoming.filter((r) => r.status === "pending").length, note: "Waiting for the organiser" },
    { label: "Next event", value: next ? day.format(new Date(next.event.start_at)) : "None", note: next?.event.name ?? "Nothing coming up" },
  ];
}
