// SCRUM-108: the coordinator sets each hold's warning time (AC1), and the list uses that window instead of a fixed 24 hours (AC4)

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, redirect: vi.fn() }));

import { EventVenueBookings } from "@/components/EventVenueBookings";
import { holdCountdown } from "@/lib/holds";
import type { EventVenueBookingItem } from "@/lib/venueBookings";

const NOW = new Date("2030-11-10T12:00:00Z");
const H = 3_600_000;
const inHours = (h: number) => new Date(NOW.getTime() + h * H).toISOString();

const aHold = (over: Partial<EventVenueBookingItem> = {}): EventVenueBookingItem => ({
  id: "b-1", eventId: "evt-1", eventName: "Tech Summit", venueId: "ven-1", venueName: "Orchid Hall", date: "2030-11-20", startTime: "09:00", endTime: "17:00",
  status: "PENDING", decidedAt: null, submittedAt: "2030-10-01T00:00:00.000Z", flags: [], rejectionReason: null, cancellationReason: null,
  expectedAttendance: 100, venueRequirements: "Theatre", exceedsCapacity: false, holdExpiresAt: inHours(10), ...over,
});

function mockPut(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
afterEach(() => { vi.unstubAllGlobals(); router.refresh.mockClear(); });

describe("SCRUM-108/AC4 holdCountdown uses the hold's own window", () => {
  it("SCRUM-108/AC4 is expiring only inside the given window, and keeps SCRUM-133's 24 hours when none is given", () => {
    const window8h = 8 * H;
    expect(holdCountdown(inHours(10), NOW, window8h).state).toBe("active");
    expect(holdCountdown(inHours(8), NOW, window8h).state).toBe("expiring");
    expect(holdCountdown(inHours(20), NOW).state).toBe("expiring");
    expect(holdCountdown(inHours(30), NOW).state).toBe("active");
    expect(holdCountdown(inHours(1), NOW, window8h).remaining).toBe("in 1 hour");
  });
});

describe("SCRUM-108/AC4 the list warns inside each hold's own window", () => {
  it("SCRUM-108/AC4 shows no warning for a hold outside its window, even though it is inside 24 hours", () => {
    render(<EventVenueBookings bookings={[aHold({ holdExpiresAt: inHours(10), holdWarningMinutes: 480 })]} now={NOW} />);
    expect(screen.getByTestId("hold-countdown").getAttribute("data-state")).toBe("active");
    expect(screen.queryByTestId("hold-warning")).toBeNull();
  });

  it("SCRUM-108/AC4 shows 'Hold expires in 8 hours' inside the window", () => {
    render(<EventVenueBookings bookings={[aHold({ holdExpiresAt: inHours(8), holdWarningMinutes: 480 })]} now={NOW} />);
    expect(screen.getByTestId("hold-warning").textContent).toBe("Hold expires in 8 hours");
    expect(screen.getByTestId("hold-countdown").getAttribute("data-state")).toBe("expiring");
  });

  it("SCRUM-108/AC4 uses 24 hours for a hold that has no window of its own", () => {
    render(<EventVenueBookings bookings={[aHold({ holdExpiresAt: inHours(20) })]} now={NOW} />);
    expect(screen.getByTestId("hold-warning").textContent).toBe("Hold expires in 20 hours");
  });

  it("SCRUM-108/AC4 says an expired hold is expired and the venue is no longer reserved", () => {
    render(<EventVenueBookings bookings={[aHold({ holdExpiresAt: inHours(-1) })]} now={NOW} />);
    expect(screen.getByTestId("expired-hold").textContent).toContain("Hold expired, venue no longer reserved");
  });
});

describe("SCRUM-108/AC1 the coordinator sets the warning time on a hold", () => {
  const form = () => within(screen.getByTestId("venue-booking-card"));

  it("SCRUM-108/AC1 offers it, filled with the current window in hours, on a pending hold the viewer can change", () => {
    render(<EventVenueBookings bookings={[aHold({ holdWarningMinutes: 480 })]} now={NOW} canChange />);
    expect((form().getByLabelText("Warn me this many hours before the hold expires") as HTMLInputElement).value).toBe("8");
  });

  it("SCRUM-108/AC1 starts at 24 hours when the hold has no window of its own", () => {
    render(<EventVenueBookings bookings={[aHold()]} now={NOW} canChange />);
    expect((form().getByLabelText("Warn me this many hours before the hold expires") as HTMLInputElement).value).toBe("24");
  });

  it.each([
    ["the viewer cannot change the booking", aHold(), false],
    ["the booking is approved", aHold({ status: "APPROVED", holdExpiresAt: null }), true],
    ["the hold has no expiry", aHold({ holdExpiresAt: null }), true],
  ])("SCRUM-108/AC1 offers nothing when %s", (_why, booking, canChange) => {
    render(<EventVenueBookings bookings={[booking]} now={NOW} canChange={canChange} />);
    expect(screen.queryByLabelText("Warn me this many hours before the hold expires")).toBeNull();
  });

  it("SCRUM-108/AC1 saves the hours as minutes against that hold, says so and reloads", async () => {
    const fetchMock = mockPut(200, { id: "b-1", status: "PENDING", holdWarningMinutes: 360 });
    render(<EventVenueBookings bookings={[aHold({ id: "b-1" })]} now={NOW} canChange />);

    fireEvent.change(form().getByLabelText("Warn me this many hours before the hold expires"), { target: { value: "6" } });
    fireEvent.click(form().getByRole("button", { name: "Save warning time" }));

    await waitFor(() => expect(form().getByRole("status").textContent).toContain("Warning time saved"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/venue-bookings/b-1/hold-warning");
    expect(init).toMatchObject({ method: "PUT", credentials: "include", body: JSON.stringify({ minutes: 360 }) });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("SCRUM-108/AC1 shows the service's reason and does not reload when it refuses", async () => {
    mockPut(422, { code: "VALIDATION_FAILED", fieldErrors: { minutes: "A warning time from 1 minute to 30 days is required." } });
    render(<EventVenueBookings bookings={[aHold()]} now={NOW} canChange />);

    fireEvent.click(form().getByRole("button", { name: "Save warning time" }));

    expect((await form().findByRole("alert")).textContent).toContain("from 1 minute to 30 days");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("SCRUM-108/AC1 asks for a number of hours before sending anything", () => {
    const fetchMock = mockPut(200, {});
    render(<EventVenueBookings bookings={[aHold()]} now={NOW} canChange />);

    fireEvent.change(form().getByLabelText("Warn me this many hours before the hold expires"), { target: { value: "" } });
    fireEvent.click(form().getByRole("button", { name: "Save warning time" }));

    expect(form().getByRole("alert").textContent).toContain("whole number of hours");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
