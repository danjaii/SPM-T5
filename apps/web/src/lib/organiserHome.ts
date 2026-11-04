/** SCRUM-159 (Figma 02): one event on the Event Organiser Home, as GET /events/my-requests/home sends it (organiser_home()). */
export interface OrganiserHomeEvent {
  id: string;
  name: string;
  status: string;
  start: string | null;
  end: string | null;
  expected_attendance: number | null;
  submitted_at: string | null;
  updated_at: string | null;
  /** Venues with an approved booking. */
  venue_names: string[];
  coordinator_name: string | null;
  coordinator_assigned_at: string | null;
  /** AC2: a clarification request from the coordinator that the organiser has not answered. */
  clarification: { author_name: string; text: string; asked_at: string } | null;
  /** AC3: the latest change request a coordinator decided. */
  change_outcome: { status: "approved" | "rejected"; decided_at: string | null } | null;
}

export type OrganiserTab = "all" | "drafts" | "in_progress" | "confirmed";

/** The statuses the design counts as "Confirmed" and "In review"; every other non-draft status is "in progress". */
const CONFIRMED = ["confirmed", "completed"];
const IN_REVIEW = ["submitted", "under_review", "returned"];

export const isDraft = (e: OrganiserHomeEvent) => e.status === "draft";
export const isConfirmed = (e: OrganiserHomeEvent) => CONFIRMED.includes(e.status);
const isInProgress = (e: OrganiserHomeEvent) => !isDraft(e) && !isConfirmed(e);

export function eventsInTab(events: OrganiserHomeEvent[], tab: OrganiserTab): OrganiserHomeEvent[] {
  if (tab === "drafts") return events.filter(isDraft);
  if (tab === "confirmed") return events.filter(isConfirmed);
  if (tab === "in_progress") return events.filter(isInProgress);
  return events;
}

/** SCRUM-159/AC1: the four figures at the top of the page, and the counts on the tabs. */
export function homeCounts(events: OrganiserHomeEvent[]) {
  return {
    all: events.length,
    drafts: events.filter(isDraft).length,
    inReview: events.filter((e) => IN_REVIEW.includes(e.status)).length,
    needsReply: events.filter((e) => e.clarification).length,
    inProgress: events.filter(isInProgress).length,
    confirmed: events.filter(isConfirmed).length,
  };
}

/** The soonest confirmed event that has not started, for the Confirmed card's "Next: …" line. */
export function nextConfirmed(events: OrganiserHomeEvent[], now: Date): OrganiserHomeEvent | undefined {
  return events
    .filter((e) => e.status === "confirmed" && e.start && new Date(e.start) >= now)
    .sort((a, b) => new Date(a.start!).getTime() - new Date(b.start!).getTime())[0];
}

/** The events waiting on the organiser, most recently asked first (the banner shows the first). */
export function needingReply(events: OrganiserHomeEvent[]): OrganiserHomeEvent[] {
  return events.filter((e) => e.clarification).sort((a, b) => b.clarification!.asked_at.localeCompare(a.clarification!.asked_at));
}

// Dates are shown in Singapore time, like the rest of the app
const SGT = "Asia/Singapore";
export const formatDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: SGT });
export const formatShortDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: SGT });
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: SGT });

/** "9:00–17:00" (or just the start when there is no end). */
export const formatTimeRange = (start: string, end: string | null) => (end ? `${formatTime(start)}–${formatTime(end)}` : formatTime(start));

/** The grey line under an event's name: where it is, how far a draft got, or that it waits for a coordinator. */
export function eventSubline(e: OrganiserHomeEvent, lastSaved: string | null): string {
  if (isDraft(e)) return lastSaved ? `Last edited ${lastSaved}` : "Draft";
  if (e.venue_names.length > 0) return e.venue_names.join(" + ");
  return e.coordinator_name ? "No venue confirmed yet" : "Waiting for a coordinator";
}

/** AC3: "Change request approved" or "Change request rejected" with its date. */
export function changeOutcomeText(o: NonNullable<OrganiserHomeEvent["change_outcome"]>): string {
  return `Change request ${o.status}${o.decided_at ? ` ${formatShortDay(o.decided_at)}` : ""}`;
}
