// SCRUM-108/AC1, AC2, AC3, AC5 and SCRUM-97/AC4 on the coordinator's own pages: My venue bookings (/venue-bookings) and the
// booking detail page (/venue-bookings/<id>). The event page already had the card; these pages had nothing.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, redirect: vi.fn() }));

import { VenueBookingDetail } from "@/components/VenueBookingDetail";
import { VenueBookingList } from "@/components/VenueBookingList";
import { holdNotice } from "@/lib/holds";
import type { VenueBookingDetailView, VenueBookingListItem } from "@/lib/venueBookings";

const NOW = new Date("2030-11-10T12:00:00Z");
const H = 3_600_000;
const inHours = (h: number) => new Date(NOW.getTime() + h * H).toISOString();

const listItem = (over: Record<string, unknown> = {}): VenueBookingListItem =>
  ({
    id: "b-1", eventId: "evt-1", eventName: "Summit A", venueId: "ven-1", venueName: "Orchid Hall", date: "2030-11-20",
    startTime: "09:00", endTime: "17:00", status: "PENDING", decidedAt: null, submittedAt: "2030-10-01T00:00:00.000Z", flags: [],
    holdExpiresAt: inHours(8), ...over,
  }) as VenueBookingListItem;

const detail = (over: Record<string, unknown> = {}): VenueBookingDetailView =>
  ({ ...listItem(over), expectedAttendance: 60, venueRequirements: null, accessibilityNeeds: null, rejectionReason: null, suggestion: null, amendsRequestId: null, chain: [] }) as VenueBookingDetailView;

afterEach(() => { vi.unstubAllGlobals(); router.refresh.mockClear(); });

describe("holdNotice (the one rule both pages use)", () => {
  it("SCRUM-108/AC2 says 'Hold expires in 8 hours' inside the hold's window", () => {
    expect(holdNotice(listItem({ holdWarningMinutes: 1440 }), NOW)).toEqual({ kind: "warning", text: "Hold expires in 8 hours" });
  });
  it("SCRUM-108/AC3 says nothing outside the window, even inside the 24-hour default", () => {
    expect(holdNotice(listItem({ holdExpiresAt: inHours(10), holdWarningMinutes: 8 * 60 }), NOW)).toBeUndefined();
  });
  it("SCRUM-108/AC2 uses 24 hours when the hold has no window of its own", () => {
    expect(holdNotice(listItem({ holdExpiresAt: inHours(20) }), NOW)?.kind).toBe("warning");
    expect(holdNotice(listItem({ holdExpiresAt: inHours(30) }), NOW)).toBeUndefined();
  });
  it("SCRUM-108/AC5 says an expired hold no longer reserves the venue", () => {
    expect(holdNotice(listItem({ status: "EXPIRED", holdExpiresAt: inHours(-1) }), NOW)).toEqual({ kind: "expired", text: "Hold expired, venue no longer reserved" });
  });
  it("SCRUM-108/AC6 says nothing for a confirmed booking that still carries an expiry", () => {
    expect(holdNotice(listItem({ status: "APPROVED", holdExpiresAt: inHours(2) }), NOW)).toBeUndefined();
  });
  it("shows nothing for a booking that has no expiry", () => {
    expect(holdNotice(listItem({ holdExpiresAt: null }), NOW)).toBeUndefined();
  });
});

describe("SCRUM-108/AC2, AC3, AC5 and SCRUM-97/AC4 My venue bookings", () => {
  it("SCRUM-108/AC2 shows 'Hold expires in 8 hours' on the hold's row", () => {
    render(<VenueBookingList bookings={[listItem()]} now={NOW} />);
    expect(screen.getByRole("columnheader", { name: "Hold" })).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /Summit A/ })).getByText("Hold expires in 8 hours")).toBeTruthy();
  });
  it("SCRUM-108/AC3 shows no warning while the expiry is outside the hold's window", () => {
    render(<VenueBookingList bookings={[listItem({ holdExpiresAt: inHours(40) })]} now={NOW} />);
    expect(screen.queryByText(/Hold expires/)).toBeNull();
  });
  it("SCRUM-108/AC5 and SCRUM-97/AC4 flag an expired hold with the Expired badge and the words", () => {
    render(<VenueBookingList bookings={[listItem({ status: "EXPIRED", holdExpiresAt: inHours(-3) })]} now={NOW} />);
    const row = screen.getByRole("row", { name: /Summit A/ });
    expect(within(row).getByText("Expired")).toBeTruthy();
    expect(within(row).getByText("Hold expired, venue no longer reserved")).toBeTruthy();
  });
  it("SCRUM-108/AC7 only the rows of holds carry a notice", () => {
    render(<VenueBookingList bookings={[listItem(), listItem({ id: "b-2", eventName: "Other", status: "APPROVED", holdExpiresAt: null })]} now={NOW} />);
    expect(screen.getAllByText(/Hold expires/)).toHaveLength(1);
  });
});

describe("SCRUM-108/AC1, AC2, AC5 and SCRUM-97/AC4 the booking detail page", () => {
  it("SCRUM-108/AC2 shows the warning text", () => {
    render(<VenueBookingDetail booking={detail()} now={NOW} />);
    expect(screen.getByText("Hold expires in 8 hours")).toBeTruthy();
  });
  it("SCRUM-108/AC3 shows no warning outside the window, but still lets the coordinator set the hours", () => {
    render(<VenueBookingDetail booking={detail({ holdExpiresAt: inHours(40) })} now={NOW} />);
    expect(screen.queryByText(/Hold expires/)).toBeNull();
    expect(screen.getByLabelText(/hours before the hold expires/i)).toBeTruthy();
  });
  it("SCRUM-108/AC5 and SCRUM-97/AC4 show Expired and the words, with no input to set (an expired hold cannot be warned about)", () => {
    render(<VenueBookingDetail booking={detail({ status: "EXPIRED", holdExpiresAt: inHours(-3) })} now={NOW} />);
    expect(screen.getAllByText("Expired").length).toBeGreaterThan(0);
    expect(screen.getByText("Hold expired, venue no longer reserved")).toBeTruthy();
    expect(screen.queryByLabelText(/hours before the hold expires/i)).toBeNull();
  });
  it("SCRUM-108/AC1 has no input on a confirmed booking or a request with no expiry", () => {
    const { rerender } = render(<VenueBookingDetail booking={detail({ status: "APPROVED" })} now={NOW} />);
    expect(screen.queryByLabelText(/hours before the hold expires/i)).toBeNull();
    rerender(<VenueBookingDetail booking={detail({ holdExpiresAt: null })} now={NOW} />);
    expect(screen.queryByLabelText(/hours before the hold expires/i)).toBeNull();
  });
  it("SCRUM-108/AC1 fills the hours from the hold's window, and Save sends them as minutes to that hold", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(<VenueBookingDetail booking={detail({ holdWarningMinutes: 720 })} now={NOW} />);
    const input = screen.getByLabelText(/hours before the hold expires/i) as HTMLInputElement;
    expect(input.value).toBe("12");
    fireEvent.change(input, { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save warning time" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/venue-bookings/b-1/hold-warning");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ minutes: 360 });
  });
});
