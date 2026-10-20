import { describe, expect, it } from "vitest";
import { leadKpis, shortDate, waitingLabel } from "@/lib/leadQueueView";
import type { LeadCoordinator, LeadQueueItem, LeadSummary } from "@/lib/leadServer";

const now = new Date("2031-01-05T03:04:00Z");
const request = (submitted_at: string | null): LeadQueueItem => ({
  id: "e",
  name: "E",
  organiser_name: null,
  preferred_start_datetime: null,
  preferred_end_datetime: null,
  expected_attendance: null,
  submitted_at,
});
const coordinators: LeadCoordinator[] = [
  { id: "a", full_name: "Mei Lin", workload: 2 },
  { id: "b", full_name: "Daniel Tan", workload: 4 },
];
const summary: LeadSummary = { events_this_month: 9, next_event_name: "Robotics Meetup", next_event_start: "2031-11-14T02:00:00Z", reassigned_this_week: 2 };

describe("SCRUM-126/AC1 the figures above the Lead's queue", () => {
  it("SCRUM-126/AC1 gives the four figures: unassigned with the oldest wait, active events, events this month, reassigned this week", () => {
    expect(leadKpis([request("2031-01-02T03:04:00Z"), request("2031-01-04T00:00:00Z")], coordinators, summary, now)).toEqual([
      { label: "Unassigned", value: 2, note: "Oldest waiting 3 days", warn: true },
      { label: "Active events", value: 6, note: "Across 2 coordinators" },
      { label: "Events this month", value: 9, note: "Next: Robotics Meetup, 14 Nov" },
      { label: "Reassigned this week", value: 2, note: "Both coordinators notified" },
    ]);
  });

  it("SCRUM-126/AC11 says nothing is waiting, and no event is coming up, when there is nothing to show", () => {
    const [unassigned, , month] = leadKpis([], coordinators, { ...summary, next_event_name: null, next_event_start: null }, now);
    expect(unassigned).toEqual({ label: "Unassigned", value: 0, note: "Nothing is waiting", warn: false });
    expect(month.note).toBe("No event coming up");
  });

  it("SCRUM-126/AC11 leaves out a figure whose source failed instead of showing zero", () => {
    expect(leadKpis([request(null)], undefined, undefined, now).map((k) => k.label)).toEqual(["Unassigned"]);
  });

  it("SCRUM-126/AC1 formats waits and dates in whole days, with the year only when it differs", () => {
    expect(waitingLabel("2031-01-04T03:04:00Z", now)).toBe("1 day");
    expect(waitingLabel("2031-01-05T01:00:00Z", now)).toBe("Today");
    expect(shortDate("2031-12-05T05:00:00Z", now)).toBe("5 Dec");
    expect(shortDate("2032-01-05T05:00:00Z", now)).toBe("5 Jan 2032");
  });
});
