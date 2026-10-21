import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-123" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect }));

import { BookingQueueDetail } from "@/components/BookingQueueDetail";
import { BookingQueueList } from "@/components/BookingQueueList";
import { occupiedWindow, timingNote } from "@/lib/bookingQueue";
import { DashboardView, type DashboardData } from "@/components/DashboardView";
import type { QueueDetailView, QueueItemView } from "@/lib/bookingQueue";
import { getBookingQueue, getQueuedBooking } from "@/lib/bookingQueueServer";

const item = (over: Partial<QueueItemView> = {}): QueueItemView => ({
  id: "b-1", eventId: "evt-1", suitability: null, suitabilityUnmet: [], suitabilityOverrideReason: null, venueId: "ven-1", venueName: "Grand Hall", setupMinutes: 0, turnaroundMinutes: 0, date: "2099-01-01", startTime: "09:00", endTime: "12:00",
  eventName: "Tech Summit", expectedAttendance: 120, venueRequirements: "Projector", accessibilityNeeds: "Step-free access",
  requestedByName: "Rachel Tan", submittedAt: "2098-12-01T02:30:00.000Z", amendsRequestId: null, flags: [], ...over,
});

const detail = (over: Partial<QueueDetailView> = {}): QueueDetailView => ({
  ...item(), status: "PENDING", decidedByName: null, decidedAt: null, rejectionReason: null, suggestion: null, ...over,
});

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cookieValue.current = "token-123";
  redirect.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SCRUM-37/AC1 queue contents (37-S1)", () => {
  it("37-S1: lists each request with its venue, slot, coordinator and check", () => {
    render(<BookingQueueList requests={[item()]} />);

    const cells = screen.getAllByRole("row")[1].querySelectorAll("td");
    expect(screen.getByRole("link", { name: "Tech Summit" }).getAttribute("href")).toBe("/booking-queue/b-1");
    expect(cells[0].textContent).toContain("Requested by Rachel Tan");
    expect(cells[1].textContent).toBe("Grand Hall");
    expect(cells[2].textContent).toContain("2099-01-01");
    expect(cells[2].textContent).toContain("Event 09:00–12:00");
    expect(cells[3].textContent).toBe("Not checked"); // SCRUM-110: no stored result on this request
  });

  it("SCRUM-134/AC6: a flagged request shows a Conflict badge, with an icon as well as the label", () => {
    render(<BookingQueueList requests={[item({ flags: [{ id: "f", label: "Buffer conflict" } as never] })]} />);
    expect(screen.getByText("Conflict")).toBeTruthy();
    expect(screen.getAllByTestId("status-icon").length).toBeGreaterThan(0);
  });
});

describe("SCRUM-134/AC1 the time window includes setup and turnaround", () => {
  it("shows the event time and the whole time the venue is occupied", () => {
    render(<BookingQueueList requests={[item({ setupMinutes: 30, turnaroundMinutes: 45 })]} />);
    expect(screen.getByText(/Venue occupied 08:30–12:45/).textContent).toContain("30 min setup, 45 min reset");
  });

  it("a venue with no setup or turnaround has the same window and no note", () => {
    render(<BookingQueueList requests={[item()]} />);
    expect(screen.getByText(/Venue occupied 09:00–12:00/).textContent).not.toContain("setup");
  });

  it("occupiedWindow wraps past midnight and timingNote is empty when both are zero", () => {
    expect(occupiedWindow({ startTime: "00:10", endTime: "23:50", setupMinutes: 30, turnaroundMinutes: 30 })).toBe("23:40–00:20");
    expect(timingNote({ setupMinutes: 0, turnaroundMinutes: 0 })).toBeNull();
  });

  it("lists requests in the order the server sends them, which is oldest first", () => {
    render(<BookingQueueList requests={[item({ id: "old", eventName: "First" }), item({ id: "new", eventName: "Second" })]} />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["First", "Second"]);
  });
});

describe("SCRUM-37/AC4 amended requests (37-S4)", () => {
  it("37-S4: marks a request that amends an earlier one", () => {
    render(<BookingQueueList requests={[item({ id: "b-1" }), item({ id: "b-2", eventName: "Other", amendsRequestId: "b-0" })]} />);

    expect(screen.getAllByText("Amends an earlier request")).toHaveLength(1);
  });
});

describe("SCRUM-134/AC10 empty queue (37-S5)", () => {
  it("37-S5: shows a message rather than an empty table", () => {
    render(<BookingQueueList requests={[]} />);

    expect(screen.getByText("No pending booking requests.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("SCRUM-37/AC6 request detail (37-S6)", () => {
  it("37-S6: a pending request shows everything in the queue plus its status", () => {
    render(<BookingQueueDetail booking={detail()} />);

    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByText("Pending", { selector: ".event__status *" })).toBeTruthy();
    for (const text of ["Grand Hall", "2099-01-01", "09:00–12:00", "120", "Projector", "Step-free access", "Rachel Tan"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
    expect(screen.getByText("2098-12-01 10:30")).toBeTruthy();
    expect(screen.queryByText("Decided by")).toBeNull();
    expect(screen.queryByText("Reason for rejection")).toBeNull();
  });

  it("37-S6: a decided request shows who decided, when, and the rejection reason", () => {
    render(
      <BookingQueueDetail
        booking={detail({
          status: "REJECTED", decidedByName: "Kenneth Wong", decidedAt: "2099-01-05T06:15:00.000Z", rejectionReason: "Under renovation.",
        })}
      />,
    );

    expect(screen.getByText("Rejected", { selector: ".event__status *" })).toBeTruthy();
    expect(screen.getByText("Kenneth Wong")).toBeTruthy();
    expect(screen.getByText("2099-01-05 14:15")).toBeTruthy();
    expect(screen.getByText("Reason for rejection")).toBeTruthy();
    expect(screen.getByText("Under renovation.")).toBeTruthy();
  });

  it("37-S6: links to the request this one amends", () => {
    render(<BookingQueueDetail booking={detail({ amendsRequestId: "b-0" })} />);

    expect(screen.getByRole("link", { name: "View the earlier request" }).getAttribute("href")).toBe("/booking-queue/b-0");
  });

  it("37-S6: no link when it amends nothing", () => {
    render(<BookingQueueDetail booking={detail()} />);

    expect(screen.queryByRole("link", { name: "View the earlier request" })).toBeNull();
  });
});

describe("SCRUM-37/AC1, AC6 loading from venue-service", () => {
  it("asks venue-service for the queue with the session cookie", async () => {
    const fetchMock = mockServer(200, [item()]);

    await expect(getBookingQueue()).resolves.toEqual({ requests: [item()] });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4003/booking-queue");
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });

  it("37-S7: passes on venue-service's refusal for anyone but Venue Staff", async () => {
    mockServer(403, { error: "You are not allowed to do that." });
    await expect(getBookingQueue()).resolves.toEqual({ error: "You are not allowed to do that." });

    mockServer(403, {});
    await expect(getBookingQueue()).resolves.toEqual({ error: "We couldn't load the pending booking requests." });
  });

  it("loads one request and passes on venue-service's message when it can't", async () => {
    const fetchMock = mockServer(200, detail());
    await expect(getQueuedBooking("b-1")).resolves.toEqual({ booking: detail() });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4003/booking-queue/b-1");

    mockServer(404, { error: "Venue booking request not found." });
    await expect(getQueuedBooking("nope")).resolves.toEqual({ error: "Venue booking request not found." });

    mockServer(500, {});
    await expect(getQueuedBooking("b-1")).resolves.toEqual({ error: "We couldn't load this venue booking request." });
  });

  it("sends anyone without a session to sign in", async () => {
    cookieValue.current = undefined;
    await expect(getBookingQueue()).rejects.toThrow("redirect:/login");

    cookieValue.current = "expired";
    mockServer(401, { error: "Not signed in." });
    await expect(getQueuedBooking("b-1")).rejects.toThrow("redirect:/login");
  });
});

describe("SCRUM-37/AC1, AC7 dashboard link", () => {
  const data: DashboardData = {
    user: { fullName: "Kenneth Wong", email: "kenneth@example.com", role: "venue_staff" },
    sections: [],
  };

  it.each([
    ["venue_staff", true],
    ["event_coordinator", false],
    ["event_organiser", false],
    ["attendee", false],
    ["technical_support_staff", false],
  ])("for a %s, shows the 'Pending booking requests' link: %s", (role, shown) => {
    render(<DashboardView data={{ ...data, user: { ...data.user, role } }} />);

    const link = screen.queryByRole("link", { name: "Pending booking requests" });
    if (shown) expect(link?.getAttribute("href")).toBe("/booking-queue");
    else expect(link).toBeNull();
  });
});
