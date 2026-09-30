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

import { VenueBookingDetail } from "@/components/VenueBookingDetail";
import { VenueBookingList } from "@/components/VenueBookingList";
import { getVenueBooking, getVenueBookingForm, getVenueBookings, type VenueBookingDetailView } from "@/lib/venueBookings";

const item = (over = {}) => ({
  id: "b-1", eventId: "evt-1", eventName: "Tech Summit", venueId: "ven-1", venueName: "Grand Hall",
  date: "2099-01-01", startTime: "09:00", endTime: "12:00", status: "PENDING" as const,
  decidedAt: null, submittedAt: "2098-12-01T00:00:00.000Z", ...over,
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

describe("SCRUM-33/AC1 venue booking list (33-S1, 33-S4)", () => {
  it("33-S4: shows the empty state when there are no requests", () => {
    render(<VenueBookingList bookings={[]} />);

    expect(screen.getByText("You have no venue booking requests.")).toBeTruthy();
  });

  it("33-S1: lists each request with its status, and a decision date only for approved or rejected ones", () => {
    render(
      <VenueBookingList
        bookings={[
          item({ id: "b-1", eventName: "Pending Event", status: "PENDING", decidedAt: "2099-01-05T02:00:00.000Z" }),
          item({ id: "b-2", eventName: "Approved Event", status: "APPROVED", decidedAt: "2099-01-05T02:00:00.000Z" }),
          item({ id: "b-3", eventName: "Rejected Event", status: "REJECTED", decidedAt: "2099-01-06T02:00:00.000Z" }),
          item({ id: "b-4", eventName: "Withdrawn Event", status: "WITHDRAWN" }),
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "Pending Event" }).getAttribute("href")).toBe("/venue-bookings/b-1");
    const rows = screen.getAllByRole("row").slice(1);
    const decidedCell = (i: number) => rows[i].querySelectorAll("td")[5].textContent;
    expect(decidedCell(0)).toBe("");
    expect(decidedCell(1)).toBe("5 Jan 2099");
    expect(decidedCell(2)).toBe("6 Jan 2099");
    expect(decidedCell(3)).toBe("");
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Withdrawn")).toBeTruthy();
  });
});

describe("SCRUM-33/AC4 venue booking detail (33-S2, 33-S5)", () => {
  const detail: VenueBookingDetailView = {
    ...item({ id: "b-2", status: "REJECTED", decidedAt: "2099-01-06T02:00:00.000Z" }),
    expectedAttendance: 120,
    venueRequirements: "Projector",
    accessibilityNeeds: null,
    rejectionReason: "Under renovation.",
    suggestion: { venueId: "ven-2", venueName: "Small Hall", date: "2099-01-02", startTime: "10:00", endTime: "13:00" },
    amendsRequestId: "b-1",
    chain: [
      { ...item({ id: "b-1", status: "REJECTED" }), rejectionReason: "Too small." },
      { ...item({ id: "b-2", status: "REJECTED" }), rejectionReason: "Under renovation." },
    ],
  };

  it("33-S2: shows the reason for rejection and the suggested alternative", () => {
    render(<VenueBookingDetail booking={detail} />);

    expect(screen.getByRole("heading", { name: "Tech Summit" })).toBeTruthy();
    expect(screen.getByText("Rejected", { selector: ".event__status .status-badge" })).toBeTruthy();
    expect(screen.getAllByText("Under renovation.").length).toBeGreaterThan(0);
    expect(screen.getByText(/Small Hall on 2099-01-02/)).toBeTruthy();
    expect(screen.getByText("Projector")).toBeTruthy();
  });

  it("33-S5: shows the amendment chain with each step's outcome, linking to the other steps", () => {
    render(<VenueBookingDetail booking={detail} />);

    expect(screen.getByRole("heading", { name: "Amendment history" })).toBeTruthy();
    expect(screen.getByText("Too small.")).toBeTruthy();
    expect(screen.getAllByRole("link")[0].getAttribute("href")).toBe("/venue-bookings/b-1");
  });

  it("leaves out the reason, suggestion and chain when there are none", () => {
    render(
      <VenueBookingDetail
        booking={{ ...detail, status: "PENDING", rejectionReason: null, suggestion: null, chain: [detail.chain[1]] }}
      />,
    );

    expect(screen.queryByText("Reason for rejection")).toBeNull();
    expect(screen.queryByText("Suggested alternative")).toBeNull();
    expect(screen.queryByText("Amendment history")).toBeNull();
  });
});

describe("SCRUM-32/AC1, SCRUM-33/AC1 loading from venue-service", () => {
  it("asks venue-service for the coordinator's requests with the session cookie", async () => {
    const fetchMock = mockServer(200, [item()]);

    await expect(getVenueBookings()).resolves.toEqual({ bookings: [item()] });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4003/venue-bookings");
    expect(options.headers.cookie).toBe("cs_session=token-123");
  });

  it("loads one request and passes on venue-service's message when it can't", async () => {
    mockServer(200, item());
    await expect(getVenueBooking("b-1")).resolves.toEqual({ booking: item() });

    mockServer(404, { error: "Venue booking request not found." });
    await expect(getVenueBooking("nope")).resolves.toEqual({ error: "Venue booking request not found." });
  });

  it("loads the request form data and the venues, or the not-eligible message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ eventId: "evt-1" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: "ven-1" }] });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getVenueBookingForm("evt-1")).resolves.toEqual({ form: { eventId: "evt-1" }, venues: [{ id: "ven-1" }] });
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4003/events/evt-1/venue-booking-form");

    mockServer(409, { code: "EVENT_NOT_ELIGIBLE", error: "The event must be approved before a venue can be requested." });
    await expect(getVenueBookingForm("evt-1")).resolves.toEqual({
      error: "The event must be approved before a venue can be requested.",
    });
  });

  it("sends visitors who aren't signed in to the sign-in page", async () => {
    cookieValue.current = undefined;
    await expect(getVenueBookings()).rejects.toThrow("redirect:/login");

    cookieValue.current = "expired";
    mockServer(401, { error: "Not signed in." });
    await expect(getVenueBookings()).rejects.toThrow("redirect:/login");
  });
});
