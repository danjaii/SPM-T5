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

// SCRUM-133/AC1: each venue booking is its own card
const rows = () => screen.getAllByTestId("venue-booking-card");

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
    expect(first.textContent).toContain("14 Nov 2030");
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
    expect(first.textContent).toContain("80 people");
    expect(second.textContent).toContain("Attendance not specified");
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
      { id: "e-1", equipment: "AV: Projector Unit", quantity: 2, venueName: "Orchid Hall", venueBookingId: "b-pending", notes: null, status: "ARRANGED" as const, statusLabel: "Arranged", releasedReason: null, reason: null, equipmentId: "eq-1", canEdit: false, lastChangedBy: null, lastChangedAt: null },
      { id: "e-2", equipment: "Audio: Microphone", quantity: 1, venueName: "Lotus Room", venueBookingId: "b-approved", notes: null, status: "SUBMITTED" as const, statusLabel: "Submitted", releasedReason: null, reason: null, equipmentId: "eq-1", canEdit: false, lastChangedBy: null, lastChangedAt: null },
      { id: "e-3", equipment: "Cable", quantity: 5, venueName: "Orchid Hall", venueBookingId: "b-pending", notes: null, status: "RELEASED" as const, statusLabel: "Released", releasedReason: "x", reason: null, equipmentId: "eq-1", canEdit: false, lastChangedBy: null, lastChangedAt: null },
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

// ----------------------------------------------------------------------------
// SCRUM-133 one card per venue booking, hold countdown and expired holds
// ----------------------------------------------------------------------------

describe("SCRUM-133/AC1 a separate card for each venue booking, with its own status", () => {
  it("133-S1 requesting a second venue gives two cards, each with its own status", () => {
    render(
      <EventVenueBookings
        bookings={[aBooking(), aBooking({ id: "b-2", venueName: "Lotus Room", status: "PENDING", decidedAt: null })]}
      />,
    );

    const [first, second] = screen.getAllByTestId("venue-booking-card");
    expect(within(first).getByText("Orchid Hall")).toBeTruthy();
    expect(within(first).getByText("Approved")).toBeTruthy();
    expect(within(second).getByText("Lotus Room")).toBeTruthy();
    expect(within(second).getByText("Pending")).toBeTruthy();
  });

  it("133-S2 the Venues tab offers + Add venue only when it is given somewhere to go", () => {
    const { rerender } = render(<EventVenueBookings bookings={[aBooking()]} requestHref="/events/evt-1/venue-request" />);
    expect(screen.getByRole("link", { name: "+ Add venue" }).getAttribute("href")).toBe("/events/evt-1/venue-request");

    rerender(<EventVenueBookings bookings={[aBooking()]} />);
    expect(screen.queryByRole("link", { name: "+ Add venue" })).toBeNull();
  });
});

describe("SCRUM-133/AC2 a hold shows a countdown that turns to a warning within 24 hours", () => {
  const now = new Date("2030-11-10T12:00:00");
  const hold = (expires: string) => aBooking({ status: "PENDING", decidedAt: null, holdExpiresAt: expires });

  it("133-S3 a hold more than 24 hours from expiry shows Hold and a calm countdown", () => {
    render(<EventVenueBookings bookings={[hold("2030-11-13T18:00:00")]} now={now} />);

    const card = screen.getByTestId("venue-booking-card");
    expect(within(card).getByText("Hold")).toBeTruthy();
    expect(within(card).getByTestId("hold-countdown").getAttribute("data-state")).toBe("active");
    expect(within(card).getByTestId("hold-countdown").textContent).toContain("in 3 days");
  });

  it("133-S4 within 24 hours it turns to the warning tone and says Hold expiring", () => {
    render(<EventVenueBookings bookings={[hold("2030-11-10T18:00:00")]} now={now} />);

    const card = screen.getByTestId("venue-booking-card");
    expect(within(card).getByText("Hold expiring")).toBeTruthy();
    expect(within(card).getByTestId("hold-countdown").getAttribute("data-state")).toBe("expiring");
    expect(within(card).getByTestId("hold-countdown").textContent).toContain("in 6 hours");
  });

  it("133-S5 a booking that is not on hold shows no countdown", () => {
    render(<EventVenueBookings bookings={[aBooking({ status: "PENDING" })]} now={now} />);

    expect(screen.queryByTestId("hold-countdown")).toBeNull();
  });
});

describe("SCRUM-133/AC3 an expired hold shows Expired and is never shown as confirmed", () => {
  const now = new Date("2030-11-10T12:00:00");

  it("133-S6 a lapsed hold is an Expired row, not a card, with no actions", () => {
    render(
      <EventVenueBookings
        bookings={[aBooking({ status: "PENDING", decidedAt: null, holdExpiresAt: "2030-11-09T18:00:00" })]}
        now={now}
        canChange
      />,
    );

    expect(screen.queryByTestId("venue-booking-card")).toBeNull();
    const row = screen.getByTestId("expired-hold");
    expect(within(row).getByText("Expired")).toBeTruthy();
    expect(row.textContent).toContain("not a booking");
    expect(within(row).queryByText("Approved")).toBeNull();
    expect(within(row).queryByRole("button")).toBeNull();
    expect(within(row).queryByRole("link")).toBeNull();
  });
});

describe("SCRUM-133/AC4 cancelling one venue booking leaves the others unchanged", () => {
  it("133-S7 after one is cancelled, the other cards keep their status and actions", () => {
    render(
      <EventVenueBookings
        bookings={[
          aBooking({ id: "b-1", venueName: "Orchid Hall", status: "CANCELLED", cancellationReason: "Moved online" }),
          aBooking({ id: "b-2", venueName: "Lotus Room", status: "APPROVED" }),
        ]}
        canChange
      />,
    );

    const [cancelled, other] = screen.getAllByTestId("venue-booking-card");
    expect(within(cancelled).getByText("Cancelled")).toBeTruthy();
    expect(within(other).getByText("Approved")).toBeTruthy();
    expect(within(other).getByRole("link", { name: "Change the Lotus Room venue booking" })).toBeTruthy();
    expect(within(other).getByRole("button", { name: "Cancel the Lotus Room venue booking" })).toBeTruthy();
  });
});

// SCRUM-134/AC3: the reason Venue Staff give shows on that venue's card, and only on that one.
describe("SCRUM-134/AC3 the rejection reason shows on that venue's booking card", () => {
  it("shows the reason, with the Rejected badge, on the rejected booking's card and not on the others", () => {
    render(
      <EventVenueBookings
        bookings={[
          aBooking({ id: "b-1", venueName: "Orchid Hall", status: "REJECTED", rejectionReason: "Room 3.2 is booked from 16:30." }),
          aBooking({ id: "b-2", venueName: "Lotus Room" }),
        ]}
      />,
    );

    const [rejected, other] = rows();
    expect(within(rejected).getByText("Rejected")).toBeTruthy();
    expect(within(rejected).getByText("Room 3.2 is booked from 16:30.")).toBeTruthy();
    expect(other.textContent).not.toContain("Room 3.2 is booked");
  });
});
