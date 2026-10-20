import type { LeadCoordinator, LeadQueueItem, LeadSummary } from "./leadServer";

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_ZONE = "Asia/Singapore";

/** SCRUM-126/AC1: whole days a request has waited (never negative); null with no submission time. */
export function waitingDays(submittedAt: string | null, now = new Date()): number | null {
  if (!submittedAt) return null;
  return Math.max(0, Math.floor((now.getTime() - new Date(submittedAt).getTime()) / DAY_MS));
}

export function waitingLabel(submittedAt: string | null, now = new Date()): string {
  const days = waitingDays(submittedAt, now);
  if (days === null) return "Not specified";
  if (days === 0) return "Today";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

const yearOf = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, year: "numeric" }).format(d);

/** "5 Dec", with the year when it is not the current one: the Date column of the queue and the next-event line. */
export function shortDate(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short" }).format(date);
  return yearOf(date) === yearOf(now) ? day : `${day} ${yearOf(date)}`;
}

export interface LeadKpi {
  label: string;
  value: number;
  note: string;
  /** The oldest wait is a warning, not good news, so it is drawn apart (icon and text, not colour alone). */
  warn?: boolean;
}

/**
 * SCRUM-126/AC1: the four figures above the queue. Unassigned and Oldest waiting come from the queue itself (already
 * oldest first), Active events from the coordinators' workloads, the rest from lead_queue_summary(). A figure whose
 * source failed is left out rather than shown as zero.
 */
export function leadKpis(
  queue: LeadQueueItem[],
  coordinators: LeadCoordinator[] | undefined,
  summary: LeadSummary | undefined,
  now = new Date(),
): LeadKpi[] {
  const oldest = queue.length > 0 ? waitingLabel(queue[0].submitted_at, now) : null;
  const kpis: LeadKpi[] = [
    { label: "Unassigned", value: queue.length, note: oldest ? `Oldest waiting ${oldest}` : "Nothing is waiting", warn: oldest !== null },
  ];
  if (coordinators) {
    kpis.push({
      label: "Active events",
      value: coordinators.reduce((sum, c) => sum + c.workload, 0),
      note: `Across ${coordinators.length} ${coordinators.length === 1 ? "coordinator" : "coordinators"}`,
    });
  }
  if (summary) {
    const next =
      summary.next_event_name && summary.next_event_start
        ? `Next: ${summary.next_event_name}, ${shortDate(summary.next_event_start, now)}`
        : "No event coming up";
    kpis.push(
      { label: "Events this month", value: summary.events_this_month, note: next },
      { label: "Reassigned this week", value: summary.reassigned_this_week, note: "Both coordinators notified" },
    );
  }
  return kpis;
}
