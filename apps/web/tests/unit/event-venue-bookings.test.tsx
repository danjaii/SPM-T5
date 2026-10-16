import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue } = vi.hoisted(() => ({ cookieValue: { current: "token-123" as string | undefined } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { EventVenueBookings } from "@/components/EventVenueBookings";
import type { EventVenueBookingItem } from "@/lib/venueBookings";
import { getEventVenueBookings } from "@/lib/venueBookingsServer";

// ----------------------------------------------------------------------------
// Test setup: venue bookings of one event, as GET /events/:eventId/venue-bookings returns them (docs/specs/multiple-venue-bookings.md)
// ----------------------------------------------------------------------------

const aBooking = (overrides: Partial<EventVenueBookingItem> = {}): EventVenueBookingItem => ({
  id: "b-1",
  eventId: "evt-1",
  eventName: "Tech Summit",
  venueId: "ven-1",
  venueName: "Orchid Hall",
  date: "2030-11-14",
  startTime: "09:00",
  endTime: "17:00",
  status: "APPROVED",
  decidedAt: "2026-10-02T00:00:00.000Z",
  submittedAt: "2026-10-01T00:00:00.000Z",
  flags: [],
  rejectionReason: null,
  cancellationReason: null,
  expectedAttendance: 100,
  venueRequirements: "Theatre",
  exceedsCapacity: false,
  ...overrides,
});

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  cookieValue.current = "token-123";
});
afterEach(() => vi.unstubAllGlobals());

const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1); // without the header row

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-98/AC5 the event page lists each venue booking
// ----------------------------------------------------------------------------

describe("SCRUM-98/AC5 the event's venue bookings section (98-S24)", () => {
  it("98-S24 shows each venue booking with its venue, date, start and end time, and status", () => {
    render(
      <EventVenueBookings
        bookings={[
          aBooking(),
          aBooking({ id: "b-2", venueId: "ven-2", venueName: "Lotus Room", startTime: "13:00", endTime: "15:00", status: "PENDING", decidedAt: null }),
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Venue bookings" })).toBeTruthy();
    const [first, second] = rows();
    expect(first.textContent).toContain("Orchid Hall");
    expect(first.textContent).toContain("2030-11-14");
    expect(first.textContent).toContain("09:00–17:00");
    expect(first.textContent).toContain("Approved");
    expect(second.textContent).toContain("Lotus Room");
    expect(second.textContent).toContain("13:00–15:00");
    expect(second.textContent).toContain("Pending");
  });

  it("98-S24 each venue name links to that venue booking's own page", () => {
    render(<EventVenueBookings bookings={[aBooking({ id: "b-7" })]} />);

    expect(screen.getByRole("link", { name: "Orchid Hall" }).getAttribute("href")).toBe("/venue-bookings/b-7");
  });

  it("98-S24 shows each venue booking's own expected attendance", () => {
    render(<EventVenueBookings bookings={[aBooking({ expectedAttendance: 80 }), aBooking({ id: "b-2", expectedAttendance: null })]} />);

    const [first, second] = rows();
    expect(first.textContent).toContain("80");
    expect(second.textContent).toContain("Not specified");
  });

  // the warning, not a refusal: the venue booking was made, and the coordinator should see that it may not fit
  it("98-S24 warns on a venue booking with more people than its venue holds, and only on that one", () => {
    render(
      <EventVenueBookings
        bookings={[aBooking({ expectedAttendance: 100 }), aBooking({ id: "b-2", venueName: "Lotus Room", expectedAttendance: 60, exceedsCapacity: true })]}
      />,
    );

    const [fits, tooMany] = rows();
    expect(within(tooMany).getByText("More people than this venue holds")).toBeTruthy();
    expect(within(fits).queryByText("More people than this venue holds")).toBeNull();
  });

  it("98-S23 shows the reason on a rejected venue booking, and a withdrawn one as withdrawn", () => {
    render(
      <EventVenueBookings
        bookings={[aBooking({ status: "REJECTED", rejectionReason: "Under renovation" }), aBooking({ id: "b-2", status: "WITHDRAWN" })]}
      />,
    );

    const [rejected, withdrawn] = rows();
    expect(rejected.textContent).toContain("Rejected");
    expect(rejected.textContent).toContain("Under renovation");
    expect(withdrawn.textContent).toContain("Withdrawn");
  });

  it("98-S22 says so when no venue has been requested for the event yet", () => {
    render(<EventVenueBookings bookings={[]} />);

    expect(screen.getByRole("heading", { name: "Venue bookings" })).toBeTruthy();
    expect(screen.getByText("No venue has been requested for this event yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  // venue-service answers only the event's assigned coordinator; for anyone else the section is left out
  it("98-S27 shows nothing when the viewer may not see the venue bookings", () => {
    const { container } = render(<EventVenueBookings bookings={null} />);

    expect(container.innerHTML).toBe("");
  });
});

describe("SCRUM-98/AC5 getEventVenueBookings (98-S21, 98-S27)", () => {
  it("98-S21 asks venue-service for the event's venue bookings as the signed-in user", async () => {
    const fetchMock = mockServer(200, [aBooking()]);

    expect(await getEventVenueBookings("evt 1")).toEqual([aBooking()]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4003/events/evt%201/venue-bookings");
    expect(fetchMock.mock.calls[0][1].headers.cookie).toContain("token-123");
    expect(fetchMock.mock.calls[0][1].cache).toBe("no-store");
  });

  it("98-S27 gives null on a refusal, an error, a network failure or no session, so the section is left out", async () => {
    mockServer(403, { error: "no" });
    expect(await getEventVenueBookings("evt-1")).toBeNull();
    mockServer(500, {});
    expect(await getEventVenueBookings("evt-1")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await getEventVenueBookings("evt-1")).toBeNull();
    cookieValue.current = undefined;
    const fetchMock = mockServer(200, [aBooking()]);
    expect(await getEventVenueBookings("evt-1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
// end of SCRUM-98

// ----------------------------------------------------------------------------
// SCRUM-102 Change and Cancel on each venue booking, and cancelled ones listed with their reason
// ----------------------------------------------------------------------------

describe("SCRUM-102/AC1, AC2 changing and cancelling from the event's list (102-S25, 102-S26)", () => {
  const five = [
    aBooking({ id: "b-pending", venueName: "Orchid Hall", status: "PENDING" }),
    aBooking({ id: "b-approved", venueName: "Lotus Room", status: "APPROVED" }),
    aBooking({ id: "b-rejected", venueName: "Jade Room", status: "REJECTED", rejectionReason: "Too small" }),
    aBooking({ id: "b-withdrawn", venueName: "Pearl Room", status: "WITHDRAWN" }),
    aBooking({ id: "b-cancelled", venueName: "Ruby Room", status: "CANCELLED", cancellationReason: "Moved online" }),
  ];
  const rowOf = (venue: string) => rows().find((r) => r.textContent?.includes(venue))!;

  // only a pending or approved venue booking can be changed or cancelled
  it("102-S26 a pending or approved venue booking has Change and Cancel; a rejected, withdrawn or cancelled one has neither", () => {
    render(<EventVenueBookings bookings={five} canChange />);

    for (const [venue, id] of [["Orchid Hall", "b-pending"], ["Lotus Room", "b-approved"]]) {
      const row = rowOf(venue);
      expect(within(row).getByRole("link", { name: `Change the ${venue} venue booking` }).getAttribute("href")).toBe(`/venue-bookings/${id}/change`);
      expect(within(row).getByRole("button", { name: `Cancel the ${venue} venue booking` })).toBeTruthy();
    }
    for (const venue of ["Jade Room", "Pearl Room", "Ruby Room"]) {
      expect(within(rowOf(venue)).queryByRole("link", { name: /Change/ })).toBeNull();
      expect(within(rowOf(venue)).queryByRole("button", { name: /Cancel/ })).toBeNull();
    }
  });

  // a Confirmed event's venues are a "material change" (SCRUM-111 to 113), so the page offers nothing
  it("102-S26 when the event can no longer have its venues changed, nothing is offered", () => {
    render(<EventVenueBookings bookings={five} canChange={false} />);

    expect(screen.queryByRole("link", { name: /^Change/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Cancel/ })).toBeNull();
  });

  it("102-S25 a cancelled venue booking shows Cancelled with its reason", () => {
    render(<EventVenueBookings bookings={five} canChange />);

    const row = rowOf("Ruby Room");
    expect(row.textContent).toContain("Cancelled");
    expect(row.textContent).toContain("Moved online");
  });

  // the cancel confirmation lists only this venue booking's equipment that is not already released (AC7)
  it("102-S29 the cancel confirmation for a venue booking lists only its own equipment that is still needed", () => {
    const equipment = [
      { id: "e-1", equipment: "AV: Projector Unit", quantity: 2, venueName: "Orchid Hall", venueBookingId: "b-pending", notes: null, status: "ARRANGED" as const, statusLabel: "Arranged", releasedReason: null },
      { id: "e-2", equipment: "Audio: Microphone", quantity: 1, venueName: "Lotus Room", venueBookingId: "b-approved", notes: null, status: "SUBMITTED" as const, statusLabel: "Submitted", releasedReason: null },
      { id: "e-3", equipment: "Cable", quantity: 5, venueName: "Orchid Hall", venueBookingId: "b-pending", notes: null, status: "RELEASED" as const, statusLabel: "Released", releasedReason: "x" },
    ];
    render(<EventVenueBookings bookings={five} canChange equipment={equipment} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel the Orchid Hall venue booking" }));

    const dialog = screen.getByRole("alertdialog", { name: "Cancel venue booking" });
    expect(within(dialog).getByText("2 × AV: Projector Unit (Arranged)")).toBeTruthy();
    expect(within(dialog).queryByText(/Microphone/)).toBeNull(); // the Lotus Room's
    expect(within(dialog).queryByText(/Cable/)).toBeNull(); // already released
  });
});
// end of SCRUM-102
