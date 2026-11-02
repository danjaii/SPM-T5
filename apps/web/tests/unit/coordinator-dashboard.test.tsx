import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

const { getCoordinatorDashboard } = vi.hoisted(() => ({ getCoordinatorDashboard: vi.fn() }));
vi.mock("@/lib/coordinatorDashboardServer", () => ({ getCoordinatorDashboard }));

import EventCoordinatorDashboard from "@/app/dashboard/event_coordinator/page";
import { coordinatorKpis, eventsThisWeek, greeting, homeSummary, needsActionCount, returnedReason } from "@/lib/coordinatorDashboard";
import type { VenueBookingListItem } from "@/lib/venueBookings";

const booking = (over: Partial<VenueBookingListItem> = {}): VenueBookingListItem => ({
  id: "b1", eventId: "e1", eventName: "Tech Summit", venueId: "v1", venueName: "Orchid Hall", date: "2026-11-20",
  startTime: "09:00", endTime: "17:00", status: "APPROVED", decidedAt: null, submittedAt: "2026-10-01T00:00:00Z", flags: [], ...over,
});
const bufferFlag = {
  id: "f1", kind: "buffer_conflict" as const, label: "Buffer conflict", createdAt: "2026-10-20T00:00:00Z",
  otherPeriod: { date: "2026-11-20", startTime: "17:00", endTime: "19:00" },
};
const event = (id: string, status: string, more: object = {}) => ({ id, name: `Event ${id}`, status, ...more });

async function renderPage(data: object) {
  getCoordinatorDashboard.mockResolvedValue(data);
  render(await EventCoordinatorDashboard());
}

describe("SCRUM-160/AC2 flagged bookings under Needs your action", () => {
  it("lists a flagged booking with its reason and a link, and not an unflagged one", async () => {
    await renderPage({
      events: [],
      bookings: [booking({ flags: [bufferFlag] }), booking({ id: "b2", eventName: "Quiet Gala" })],
      returned: [],
    });
    const section = screen.getByText("Needs your action").closest("section") as HTMLElement;
    expect(within(section).getByText("Tech Summit · Orchid Hall")).toBeTruthy();
    expect(within(section).getByText(/Buffer conflict: another booking at this venue/)).toBeTruthy();
    expect(within(section).getByRole("link", { name: /View booking for Tech Summit/ }).getAttribute("href")).toBe("/venue-bookings/b1");
    expect(within(section).queryByText(/Quiet Gala/)).toBeNull();
  });

  it("says nothing needs action when nothing is flagged or returned", async () => {
    await renderPage({ events: [], bookings: [booking()], returned: [] });
    expect(screen.getByText(/Nothing needs your action right now/)).toBeTruthy();
  });

  it("does not claim nothing needs action when both sources failed", async () => {
    await renderPage({ events: undefined, bookings: undefined, returned: undefined });
    expect(screen.queryByText(/Nothing needs your action right now/)).toBeNull();
  });
});

describe("SCRUM-160/AC3 events returned to Planning", () => {
  it("lists a returned event with the reason and a link to it", async () => {
    await renderPage({
      events: [event("e9", "planning")], bookings: [],
      returned: [{ id: "e9", name: "Expo", reason: "The Safety Officer wants changes: add exits" }],
    });
    expect(screen.getByText("Returned to Planning")).toBeTruthy();
    expect(screen.getByText("The Safety Officer wants changes: add exits")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Expo" }).getAttribute("href")).toBe("/events/e9");
  });

  it("gives the Safety Officer's open request for changes as the reason", () => {
    expect(returnedReason({
      safetyDecisions: [{ decision: "changes_requested", reason: "Add exits" }, { decision: "approved", reason: null }],
      venueBookingsSentBack: 0, equipmentRequestsSentBack: 0,
    })).toBe("The Safety Officer wants changes: Add exits");
  });

  it("ignores a decision an important change revoked and falls back to the sent-back arrangements", () => {
    expect(returnedReason({
      safetyDecisions: [{ decision: "changes_requested", reason: "Old", revoked_at: "2026-10-01T00:00:00Z" }],
      venueBookingsSentBack: 2, equipmentRequestsSentBack: 1,
    })).toBe("The event details changed, so 2 venue bookings and 1 equipment request must be reviewed again.");
  });

  it("gives no reason when nothing sent the event back", () => {
    expect(returnedReason({ safetyDecisions: null, venueBookingsSentBack: 0, equipmentRequestsSentBack: 0 })).toBeNull();
  });
});

// Figma 16 · Event Coordinator · Home. 2026-11-04 is a Wednesday; its week runs Mon 2 to Sun 8 November (Singapore time).
const WED = new Date("2026-11-04T02:00:00Z"); // 10:00 in Singapore
const at = (iso: string) => ({ preferred_start_datetime: iso });

describe("SCRUM-160 (Figma 16) Home header and figures", () => {
  it("greets by first name for the time of day in Singapore", () => {
    expect(greeting("Priya Nair", WED)).toBe("Good morning, Priya");
    expect(greeting("Priya Nair", new Date("2026-11-04T07:00:00Z"))).toBe("Good afternoon, Priya");
    expect(greeting("Priya Nair", new Date("2026-11-04T12:00:00Z"))).toBe("Good evening, Priya");
    expect(greeting(undefined, WED)).toBe("Good morning");
  });

  it("words the summary for some, none and unknown", () => {
    expect(homeSummary(5)).toBe("5 things need you today. Everything else is on track.");
    expect(homeSummary(1)).toBe("1 thing needs you today. Everything else is on track.");
    expect(homeSummary(0)).toBe("Nothing needs you today. Everything is on track.");
    expect(homeSummary(undefined)).toBe("Some of your information could not be loaded.");
  });

  it("counts flagged bookings and returned events, and leaves the count out when neither source loaded", () => {
    expect(needsActionCount([booking({ flags: [bufferFlag] }), booking({ id: "b2" })], [{}])).toBe(2);
    expect(needsActionCount(undefined, undefined)).toBeUndefined();
  });

  it("shows needs-action, active events and pending bookings, and leaves out a figure whose source failed", () => {
    const events = [event("a", "planning"), event("b", "completed")];
    const bookings = [booking({ status: "PENDING" }), booking({ id: "b2", status: "APPROVED" })];
    expect(coordinatorKpis(events, bookings, 2, 1).map((k) => [k.label, k.value])).toEqual([
      ["Needs action", 2], ["Active events", 1], ["Pending bookings", 1],
    ]);
    expect(coordinatorKpis(undefined, undefined, undefined, 0)).toEqual([]);
  });

  it("renders the greeting, the figures and a Find a venue link", async () => {
    await renderPage({ fullName: "Priya Nair", events: [event("a", "planning")], bookings: [booking({ flags: [bufferFlag] })], returned: [] });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening), Priya$/);
    const figures = within(screen.getByRole("list", { name: "Queue summary" }));
    expect(figures.getByText("Needs action")).toBeTruthy();
    expect(figures.getByText("Active events")).toBeTruthy();
    expect(figures.getByText("Pending bookings")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Find a venue" }).getAttribute("href")).toBe("/venues/search");
  });
});

describe("SCRUM-160/AC2 (Figma 16) Needs your action rows", () => {
  it("shows a count badge and a button-like action on each row, with the flag's reason", async () => {
    await renderPage({ events: [], bookings: [booking({ flags: [bufferFlag] })], returned: [] });
    const section = within(screen.getByRole("region", { name: "Needs your action" }));
    expect(section.getByText("1 to do")).toBeTruthy();
    expect(section.getByRole("link", { name: /Tech Summit at Orchid Hall/ }).textContent).toContain("Buffer conflict");
  });
});

describe("SCRUM-160 (Figma 16) This week", () => {
  it("lists open events from Monday to Sunday of this week, earliest first, with venue and start time", () => {
    const events = [
      event("late", "confirmed", at("2026-11-07T06:00:00Z")), // Sat 14:00
      event("early", "planning", at("2026-11-02T00:00:00Z")), // Mon 8:00
      event("next-week", "confirmed", at("2026-11-09T00:00:00Z")), // Mon 9 Nov, 8:00: not this week
      event("old", "confirmed", at("2026-11-01T15:59:00Z")), // Sun 1 Nov 23:59
      event("done", "completed", at("2026-11-03T00:00:00Z")),
    ];
    const week = eventsThisWeek(events, [booking({ eventId: "early", venueName: "Seminar Room 1" })], WED);
    expect(week.map((w) => [w.id, w.weekday, w.day, w.detail])).toEqual([
      ["early", "MON", 2, "Seminar Room 1 · 8:00"],
      ["late", "SAT", 7, "Venue pending · 14:00"],
    ]);
  });

  it("includes Sunday night of the week and excludes the Monday after, in Singapore time", () => {
    const sunLate = event("sun", "confirmed", at("2026-11-08T15:59:00Z")); // Sun 23:59 SGT
    const monEarly = event("mon", "confirmed", at("2026-11-08T16:00:00Z")); // Mon 00:00 SGT
    expect(eventsThisWeek([sunLate, monEarly], [], WED).map((w) => w.id)).toEqual(["sun"]);
  });

  it("renders the panel with a status badge, says so when no event starts this week, and says Unavailable when events failed", async () => {
    const now = new Date();
    await renderPage({ events: [event("a", "confirmed", { preferred_start_datetime: now.toISOString() })], bookings: [], returned: [] });
    const panel = within(screen.getByRole("region", { name: "This week" }));
    expect(panel.getByRole("link", { name: "Open Event a" })).toBeTruthy();
    expect(panel.getByText("Confirmed")).toBeTruthy();
  });

  it("says no event starts this week", async () => {
    await renderPage({ events: [event("a", "planning")], bookings: [], returned: [] });
    expect(within(screen.getByRole("region", { name: "This week" })).getByText("No events start this week.")).toBeTruthy();
  });

  it("says Unavailable when the events could not be loaded", async () => {
    await renderPage({ bookings: [], returned: [] });
    expect(within(screen.getByRole("region", { name: "This week" })).getByText("Unavailable")).toBeTruthy();
  });
});
