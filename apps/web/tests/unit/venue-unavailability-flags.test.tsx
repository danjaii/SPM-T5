import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { FlagDto } from "@spm-t5/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), redirect: vi.fn() }));

import { BookingQueueDetail } from "@/components/BookingQueueDetail";
import { BookingQueueList } from "@/components/BookingQueueList";
import { EventVenueBookings } from "@/components/EventVenueBookings";
import { VenueBookingDetail } from "@/components/VenueBookingDetail";
import { VenueBookingList } from "@/components/VenueBookingList";
import { VenueDetail, type VenueDetails } from "@/components/VenueDetail";
import type { QueueDetailView, QueueItemView } from "@/lib/bookingQueue";
import type { EventVenueBookingItem, VenueBookingDetailView, VenueBookingListItem } from "@/lib/venueBookings";

// SCRUM-106 (docs/specs/venue-unavailability-flags.md) on the web: the banner a flagged booking carries, the Flagged badge in the
// Venue Staff queue, and what the unavailability form says after saving. Text always, never colour alone.

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

const BLOCK_TEXT = "Orchid Hall is unavailable from 14 Nov 08:00 to 16 Nov 18:00 (Maintenance)";
const LABEL = "Venue unavailable – alternative needed";

const flag = (over: Partial<FlagDto> = {}): FlagDto => ({
  id: "f-1",
  kind: "venue_unavailable",
  label: LABEL,
  createdAt: "2026-11-01T00:00:00.000Z",
  otherPeriod: null,
  unavailability: { startDate: "2026-11-14", startTime: "08:00", endDate: "2026-11-16", endTime: "18:00", reason: "maintenance", reasonLabel: "Maintenance" },
  ...over,
});

const listItem = (flags: FlagDto[]): VenueBookingListItem => ({
  id: "b-1", eventId: "evt-1", eventName: "TechConf 2026", venueId: "ven-1", venueName: "Orchid Hall", date: "2026-11-14",
  startTime: "09:00", endTime: "17:00", status: "APPROVED", decidedAt: "2026-10-02T00:00:00.000Z", submittedAt: "2026-10-01T00:00:00.000Z", flags,
});

const queueItem = (flags: FlagDto[]): QueueItemView => ({
  id: "b-1", eventId: "evt-1", suitability: null, suitabilityUnmet: [], suitabilityOverrideReason: null, venueId: "ven-1", venueName: "Orchid Hall",
  date: "2026-11-15", startTime: "09:00", endTime: "12:00", eventName: "Summit C", expectedAttendance: 10, venueRequirements: null,
  accessibilityNeeds: null, requestedByName: "Rachel Tan", submittedAt: "2026-10-01T02:30:00.000Z", amendsRequestId: null, flags,
});

describe("SCRUM-106/AC1 the coordinator sees the flag as words, and the booking stays Approved (106-S1)", () => {
  it("106-S1: the list row says Approved and gives the block's period and reason", () => {
    render(<VenueBookingList bookings={[listItem([flag()])]} />);

    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText(`${LABEL}: ${BLOCK_TEXT}`)).toBeTruthy();
  });

  it("106-S1: the event page's venue bookings show it too", () => {
    const booking: EventVenueBookingItem = {
      ...listItem([flag()]), rejectionReason: null, cancellationReason: null, expectedAttendance: 10, venueRequirements: null, exceedsCapacity: false,
    };
    render(<EventVenueBookings bookings={[booking]} />);
    expect(screen.getByText(`${LABEL}: ${BLOCK_TEXT}`)).toBeTruthy();
  });

  it("106-S1: the detail banner carries the label, the period and the reason", () => {
    const booking: VenueBookingDetailView = {
      ...listItem([flag()]), expectedAttendance: 10, venueRequirements: null, accessibilityNeeds: null, rejectionReason: null,
      suggestion: null, amendsRequestId: null, chain: [],
    };
    render(<VenueBookingDetail booking={booking} />);

    const banner = screen.getByLabelText("Flags");
    expect(banner.textContent).toContain(`${LABEL}: ${BLOCK_TEXT}`);
  });
});

describe("SCRUM-106/AC3 Venue Staff see a flagged request with no Approve (106-S3)", () => {
  it("106-S3: the queue row says Flagged with the label in words", () => {
    render(<BookingQueueList requests={[queueItem([flag()])]} />);
    expect(screen.getByText(`Flagged: ${LABEL}`)).toBeTruthy();
  });

  it("106-S3: the queue detail banner gives the block's period and reason", () => {
    const booking: QueueDetailView = { ...queueItem([flag()]), status: "PENDING", decidedByName: null, decidedAt: null, rejectionReason: null, suggestion: null };
    render(<BookingQueueDetail booking={booking} />);

    const banner = screen.getByLabelText("Flags");
    expect(banner.textContent).toContain(`Flagged: ${LABEL}`);
    expect(banner.textContent).toContain(BLOCK_TEXT);
  });
});

describe("SCRUM-106/AC2 the unavailability form says how many bookings were flagged (106-S5, 106-S6)", () => {
  const venue = (): VenueDetails => ({
    id: "orchid", name: "Orchid Hall", address: "Level 3", description: null, max_capacity: 150,
    operating_hours_start: null, operating_hours_end: null, is_accessible: true, accessibility_notes: null,
    layouts: [], facilities: [], setup_minutes: 0, turnaround_minutes: 0, can_edit_timing: false,
    can_mark_unavailable: true, unavailability: [],
  });
  const fill = () => {
    const values = { "Start date": "2026-11-14", "Start time": "08:00", "End date": "2026-11-16", "End time": "18:00", Reason: "maintenance" };
    for (const [label, value] of Object.entries(values)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save unavailable period" }));
  };
  const mockServer = (body: unknown) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => body }));

  it("106-S5: three flagged -> '3 bookings affected; their coordinators have been notified.'", async () => {
    mockServer({ block: {}, affectedBookings: 3, message: "3 bookings affected; their coordinators have been notified." });
    render(<VenueDetail venue={venue()} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark unavailable" }));
    fill();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(within(screen.getByRole("status")).getByText(/3 bookings affected; their coordinators have been notified\./)).toBeTruthy();
  });

  it("106-S6: none flagged -> 'No existing bookings are affected.'", async () => {
    mockServer({ block: {}, affectedBookings: 0 });
    render(<VenueDetail venue={venue()} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark unavailable" }));
    fill();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.getByRole("status").textContent).toContain("No existing bookings are affected.");
  });
});
