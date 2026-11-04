import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

const { getBookingQueue, getVenueSchedule, getVenueBlocks, getDashboard } = vi.hoisted(() => ({
  getBookingQueue: vi.fn(),
  getVenueSchedule: vi.fn(),
  getVenueBlocks: vi.fn(),
  getDashboard: vi.fn(),
}));
vi.mock("@/lib/bookingQueueServer", () => ({ getBookingQueue, getVenueSchedule, getVenueBlocks }));
vi.mock("@/lib/dashboard", () => ({ getDashboard }));

import VenueStaffDashboard from "@/app/dashboard/venue_staff/page";
import type { QueueItemView } from "@/lib/bookingQueue";
import { decisionRows, greeting, summaryLine, venueStaffKpis } from "@/lib/venueStaffDashboard";

const request = (id: string, over: Partial<QueueItemView> = {}): QueueItemView => ({
  id, eventId: `e-${id}`, venueId: "v1", venueName: "Room 3.2", setupMinutes: 0, turnaroundMinutes: 0, date: "2026-11-14",
  startTime: "08:30", endTime: "17:45", eventName: `Event ${id}`, expectedAttendance: 50, venueRequirements: null,
  accessibilityNeeds: null, requestedByName: "Casey", submittedAt: "2026-11-01T00:00:00Z", amendsRequestId: null,
  suitability: null, suitabilityUnmet: [], suitabilityOverrideReason: null, flags: [], ...over,
});
const bufferFlag = {
  id: "f1", kind: "buffer_conflict" as const, label: "Buffer conflict", createdAt: "2026-11-02T00:00:00Z",
  otherPeriod: { date: "2026-11-14", startTime: "17:45", endTime: "19:00" },
};
const blockedFlag = {
  id: "f2", kind: "venue_unavailable" as const, label: "Venue unavailable – alternative needed", createdAt: "2026-11-02T00:00:00Z",
  otherPeriod: null,
  unavailability: { startDate: "2026-11-12", startTime: "08:00", endDate: "2026-11-16", endTime: "18:00", reason: "maintenance", reasonLabel: "Maintenance" },
};

async function renderPage(sources: { requests?: QueueItemView[] | { error: string }; schedule?: object[]; blocks?: object[] } = {}) {
  // an omitted source is empty; one passed as undefined is a source that failed
  const { requests = [], schedule = "schedule" in sources ? undefined : [], blocks = "blocks" in sources ? undefined : [] } = sources;
  getDashboard.mockResolvedValue({ user: { fullName: "Farah Ismail", email: "f@x", role: "venue_staff" }, sections: [] });
  getBookingQueue.mockResolvedValue(Array.isArray(requests) ? { requests } : requests);
  getVenueSchedule.mockResolvedValue(schedule);
  getVenueBlocks.mockResolvedValue(blocks);
  render(await VenueStaffDashboard());
}

describe("SCRUM-163/AC1 pending requests count links to the queue", () => {
  it("shows the Waiting count as a link to the queue, with how long the oldest has waited", async () => {
    await renderPage({ requests: [request("a"), request("b")] });
    const link = screen.getByRole("link", { name: /2 waiting, view them/ });
    expect(link.getAttribute("href")).toBe("/booking-queue");
    expect(screen.getByText(/Oldest waiting/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Review requests" }).getAttribute("href")).toBe("/booking-queue");
  });

  it("says nothing is waiting, and not '0 conflicts to resolve', when the queue is empty", async () => {
    await renderPage({ requests: [] });
    expect(screen.getByText("No booking requests are waiting.")).toBeTruthy();
    expect(screen.getByText(/You are all caught up/)).toBeTruthy();
  });

  it("shows Unavailable, not 0, when the queue could not be loaded", async () => {
    await renderPage({ requests: { error: "boom" } });
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("Waiting")).toBeNull();
  });

  it("words the greeting and summary", () => {
    expect(greeting("Farah Ismail", new Date("2026-11-04T01:00:00Z"))).toBe("Good morning, Farah");
    expect(greeting("Farah Ismail", new Date("2026-11-04T08:00:00Z"))).toBe("Good afternoon, Farah");
    expect(summaryLine([request("a"), request("b", { flags: [bufferFlag] })])).toBe("2 requests are waiting. 1 has a conflict you should resolve first.");
  });
});

describe("SCRUM-163/AC2 flagged requests are listed first with their flag", () => {
  it("puts flagged requests ahead of plain ones, each group keeping the queue's order", () => {
    const rows = decisionRows([request("plain1"), request("flagged", { flags: [bufferFlag] }), request("plain2")]);
    expect(rows.map((r) => r.id)).toEqual(["flagged", "plain1", "plain2"]);
  });

  it("shows a Conflict badge and a Venue unavailable badge by icon and label, and No conflicts on a plain request", async () => {
    await renderPage({ requests: [request("plain"), request("clash", { flags: [bufferFlag] }), request("blocked", { flags: [blockedFlag] })] });
    const list = screen.getByRole("heading", { name: "Needs your decision" }).closest("section")!;
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("Event clash"),
      expect.stringContaining("Event blocked"),
      expect.stringContaining("Event plain"),
    ]);
    expect(within(items[0]).getByText("Conflict")).toBeTruthy();
    expect(within(items[0]).getByTestId("status-icon")).toBeTruthy();
    expect(within(items[1]).getByText("Venue unavailable")).toBeTruthy();
    expect(within(items[2]).getByText("No conflicts")).toBeTruthy();
  });

  it("opens the request from its Review button", async () => {
    await renderPage({ requests: [request("clash", { flags: [bufferFlag] })] });
    expect(screen.getByRole("link", { name: "Review Event clash at Room 3.2" }).getAttribute("href")).toBe("/booking-queue/clash");
  });

  it("counts the flagged requests in Conflicts and names the first", () => {
    const kpis = venueStaffKpis([request("a", { flags: [bufferFlag] }), request("b")], [], []);
    expect(kpis.find((k) => k.label === "Conflicts")).toMatchObject({ value: 1, warn: true, note: "Room 3.2 on 14 Nov" });
  });
});

describe("SCRUM-163/AC3 the venue catalogue no longer fills the page", () => {
  it("shows the figures, decisions and schedule, with no catalogue table or link on the page", async () => {
    await renderPage({ requests: [request("a")] });
    expect(screen.queryByText("Venue catalogue")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("heading", { name: "Today at your venues" })).toBeTruthy();
  });

  it("lists today's approved bookings and any blocked venue, and says Unavailable when the schedule failed", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore" }).format(new Date());
    const soon = new Date(Date.now() + 86_400_000).toISOString();
    const later = new Date(Date.now() + 3 * 86_400_000).toISOString();
    await renderPage({
      schedule: [{ id: "s1", venueId: "v1", venueName: "Main Auditorium", eventName: "Annual Tech Summit", date: today, startTime: "08:00", endTime: "12:00", setupMinutes: 0, turnaroundMinutes: 0 }],
      blocks: [{ venueName: "Hall B", start: soon, end: later, reasonLabel: "Maintenance" }],
    });
    expect(screen.getByText("Annual Tech Summit")).toBeTruthy();
    expect(screen.getByText("Hall B unavailable")).toBeTruthy();
  });

  it("shows Unavailable for the schedule when it could not be loaded", async () => {
    await renderPage({ schedule: undefined });
    const panel = screen.getByRole("heading", { name: "Today at your venues" }).closest("section")!;
    expect(within(panel).getByText("Unavailable")).toBeTruthy();
  });
});
