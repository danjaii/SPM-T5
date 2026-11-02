import type { StatusDisplay } from "./status";
import type { SafetyHomeDecision, SafetyHomeEvent } from "./safetyCheckServer";

const TIME_ZONE = "Asia/Singapore";

/** SCRUM-165 (Figma 19): the greeting by the hour in Singapore, e.g. "Good morning, Nadia". */
export function greeting(fullName: string, now = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "numeric", hour12: false }).format(now)) % 24;
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const first = fullName.trim().split(/\s+/)[0];
  return first ? `Good ${part}, ${first}` : `Good ${part}`;
}

/** "Thu 14 Nov" */
export function weekdayDate(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));
}

/** "12 Oct" */
const dayMonth = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short" }).format(new Date(iso));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The line under a ready event's name: "450 people across 4 spaces · Thu 14 Nov". */
export function eventSummary(e: SafetyHomeEvent): string {
  const parts: string[] = [];
  if (e.expected_attendance !== null) {
    parts.push(
      e.venue_names.length > 0
        ? `${plural(e.expected_attendance, "person", "people")} across ${plural(e.venue_names.length, "space")}`
        : plural(e.expected_attendance, "person", "people"),
    );
  } else if (e.venue_names.length > 0) {
    parts.push(e.venue_names.join(", "));
  }
  if (e.start) parts.push(weekdayDate(e.start));
  return parts.join(" · ") || "Details not specified";
}

/** SCRUM-165/AC2: an event back for another check says so ("Re-check needed"); otherwise it is ready for a check. */
export function rowStatus(e: SafetyHomeEvent): StatusDisplay & { action: string } {
  return e.recheck
    ? { tone: "warning", icon: "alert", label: "Re-check needed", action: "Review change" }
    : { tone: "info", icon: "clipboard", label: "Safety check", action: "Start check" };
}

const DECISION_DISPLAY: Record<SafetyHomeDecision["decision"], { display: StatusDisplay; verb: string }> = {
  approved: { display: { tone: "success", icon: "check", label: "Approved" }, verb: "Approved" },
  changes_requested: { display: { tone: "warning", icon: "alert", label: "Changes requested" }, verb: "Changes requested" },
  rejected: { display: { tone: "danger", icon: "x", label: "Rejected" }, verb: "Rejected" },
};

/** A "Recently decided" row: the badge and "Approved 12 Oct". */
export function decisionView(d: SafetyHomeDecision) {
  const { display, verb } = DECISION_DISPLAY[d.decision];
  return { display, note: `${verb} ${dayMonth(d.decided_at)}` };
}
