import { AVAILABILITY_LABELS } from "./availabilityLabels";
import type { UpcomingEvent } from "./getUpcomingEvents";

// SCRUM-9: which events a typed search matches (docs/specs/event-search.md). Used by the attendee's List of events, in the browser.

// Dates are in Singapore time, like the cards
const dateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "numeric",
  weekday: "long",
});
const monthParts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Singapore", month: "long" });

/**
 * The parts of the event's date, each as a whole word: "2026-12-12", "12", "december", "2026", "saturday"; letters match the start of one, so "dec" and "sat" work. They are kept
 * apart from the other details, and matched as whole parts, so that typing "12" means the day 12, not the 12 inside "2026-12-13".
 */
function dateTokens(startAt: string): string[] {
  const date = new Date(startAt);
  const parts = Object.fromEntries(dateParts.formatToParts(date).map((part) => [part.type, part.value]));
  const month = monthParts.format(date);
  return [
    `${parts.year}-${parts.month}-${parts.day.padStart(2, "0")}`,
    parts.day,
    month,
    parts.year,
    parts.weekday,
  ].map((token) => token.toLowerCase());
}

/** Everything about an event, apart from its date, that a search looks in, as one lower-case text. A detail the event does not have is left out. */
function searchableText(event: UpcomingEvent): string {
  return [
    event.name,
    event.organisation,
    event.venue.name,
    event.venue.address,
    event.category,
    event.coordinator,
    // status: the event's own ("confirmed", "cancelled") and the label its card shows ("Event Full", "Registration Closed")
    event.status,
    AVAILABILITY_LABELS[event.availability],
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .toLowerCase();
}

/**
 * SCRUM-9/AC1: true when the event matches what was typed. The typed text is split into words, and every word has to be found
 * somewhere in the event's details (in any order, and in different details). A word is found in the details as part of a word
 * ("ball" finds "Ballroom"), or it is one of the date's parts: exactly, or, for letters, as the start of one ("dec" for "december").
 * With nothing typed there are no words, so every event matches.
 */
export function matchesSearch(event: UpcomingEvent, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = searchableText(event);
  const dates = dateTokens(event.start_at);
  return words.every(
    (word) =>
      text.includes(word) ||
      dates.some((token) => token === word || (/^[a-z]{3,}$/.test(word) && token.startsWith(word))),
  );
}
