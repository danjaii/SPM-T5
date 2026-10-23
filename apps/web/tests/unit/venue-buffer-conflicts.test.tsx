import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { FlagDto } from "@spm-t5/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), redirect: vi.fn() }));

import { BookingQueueDetail } from "@/components/BookingQueueDetail";
import { BookingQueueList } from "@/components/BookingQueueList";
import { DashboardView, type DashboardData } from "@/components/DashboardView";
import { EventVenueBookings } from "@/components/EventVenueBookings";
import { VenueBookingDetail } from "@/components/VenueBookingDetail";
import { VenueBookingList } from "@/components/VenueBookingList";
import { VenueDetail, type VenueDetails } from "@/components/VenueDetail";
import { VenueStaffDecision } from "@/components/VenueStaffDecision";
import type { QueueDetailView, QueueItemView } from "@/lib/bookingQueue";
import { decisionActions, type EventVenueBookingItem, type VenueBookingDetailView, type VenueBookingListItem } from "@/lib/venueBookings";

/** SCRUM-104 on the web: the save tells staff what clashes, the flag shows as text, and a flagged request has no Approve. */

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const SUMMIT_SENTENCE = "Summit A (occupies until 12:45) now conflicts with Summit B (occupies from 12:00)";

const venue = (extra: Partial<VenueDetails> = {}): VenueDetails => ({
  id: "orchid", name: "Orchid Hall", address: "Level 3", description: null, max_capacity: 150,
  operating_hours_start: null, operating_hours_end: null, is_accessible: true, accessibility_notes: null,
  layouts: [], facilities: [], setup_minutes: 0, turnaround_minutes: 0, can_edit_timing: true,
  ...extra,
});

const staffFlag = (over: Partial<FlagDto> = {}): FlagDto => ({
  id: "f-1", kind: "buffer_conflict", label: "Buffer conflict", createdAt: "2026-10-15T00:00:00.000Z",
  otherPeriod: { date: "2030-11-14", startTime: "10:00", endTime: "12:00" }, otherEventName: "Summit A", otherBookingId: "b-other", ...over,
});
// a coordinator's flag has neither the other booking's event name nor its id
const coordinatorFlag = (): FlagDto => ({ ...staffFlag(), otherEventName: undefined, otherBookingId: undefined });

describe("SCRUM-104/AC1 the save shows what now conflicts (104-S1)", () => {
  it("104-S1: lists the Summit A and Summit B sentence and says nothing was cancelled", async () => {
    mockServer(200, {
      setup_minutes: 30, turnaround_minutes: 45, message: "1 pair of bookings is flagged.",
      affected: [{ summary: SUMMIT_SENTENCE, first: { bookingId: "a" }, second: { bookingId: "b" } }],
    });
    render(<VenueDetail venue={venue()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit venue" }));

    fireEvent.change(screen.getByLabelText("Setup time (minutes)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Turnaround time (minutes)"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save times" }));

    await waitFor(() => expect(screen.getByText(SUMMIT_SENTENCE)).toBeTruthy());
    expect(screen.getByRole("status").textContent).toContain("saved");
    expect(screen.getByRole("status").textContent).toContain("1 pair of bookings is flagged.");
    expect(screen.getByText(/Nothing was cancelled or withdrawn/)).toBeTruthy();
  });
});

describe("SCRUM-104/AC6 no conflicts, no flags (104-S6)", () => {
  it("104-S6: tells staff no existing bookings are affected and lists nothing", async () => {
    mockServer(200, { setup_minutes: 10, turnaround_minutes: 10, message: "No existing bookings are affected.", affected: [] });
    render(<VenueDetail venue={venue()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit venue" }));

    fireEvent.change(screen.getByLabelText("Setup time (minutes)"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Turnaround time (minutes)"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save times" }));

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("No existing bookings are affected."));
    expect(screen.queryByLabelText("Bookings that now conflict")).toBeNull();
  });
});

const queueItem = (flags: FlagDto[]): QueueItemView => ({
  id: "b-1", eventId: "evt-1", suitability: null, suitabilityUnmet: [], suitabilityOverrideReason: null, venueId: "ven-1", setupMinutes: 0, turnaroundMinutes: 0, venueName: "Orchid Hall",
  date: "2030-11-14", startTime: "12:30", endTime: "14:00", eventName: "Summit B", expectedAttendance: 10, venueRequirements: null,
  accessibilityNeeds: null, requestedByName: "Rachel Tan", submittedAt: "2026-10-01T02:30:00.000Z", amendsRequestId: null, flags,
});

describe("SCRUM-104/AC4 a flagged Pending request in the queue (104-S4)", () => {
  it("104-S4: the queue row says Flagged: Buffer conflict in text; an unflagged row says nothing", () => {
    render(<BookingQueueList requests={[queueItem([staffFlag()]), { ...queueItem([]), id: "b-2", eventName: "Clean" }]} />);

    const rows = screen.getAllByRole("row");
    expect(within(rows[1]!).getByText("Flagged: Buffer conflict")).toBeTruthy();
    expect(within(rows[2]!).queryByText(/Flagged/)).toBeNull();
  });

  it("104-S4: the detail banner names the other booking, links to it and gives its time", () => {
    const booking: QueueDetailView = { ...queueItem([staffFlag()]), status: "PENDING", decidedByName: null, decidedAt: null, rejectionReason: null, suggestion: null };
    render(<BookingQueueDetail booking={booking} />);

    const banner = screen.getByLabelText("Flags");
    expect(banner.textContent).toContain("Flagged: Buffer conflict");
    expect(within(banner).getByRole("link", { name: "Summit A" }).getAttribute("href")).toBe("/booking-queue/b-other");
    expect(banner.textContent).toContain("2030-11-14 10:00–12:00");
  });

  it("104-S4: no banner when there is no flag", () => {
    const booking: QueueDetailView = { ...queueItem([]), status: "PENDING", decidedByName: null, decidedAt: null, rejectionReason: null, suggestion: null };
    render(<BookingQueueDetail booking={booking} />);
    expect(screen.queryByLabelText("Flags")).toBeNull();
  });

  it("104-S4: decisionActions hides Approve for a flagged request and keeps Reject; other statuses stay as they were", () => {
    expect(decisionActions("PENDING", true)).toEqual({ approve: false, reject: true });
    expect(decisionActions("PENDING", false)).toEqual({ approve: true, reject: true });
    expect(decisionActions("PENDING")).toEqual({ approve: true, reject: true });
    expect(decisionActions("APPROVED", true)).toEqual({ approve: false, reject: false });
  });

  it("104-S4: the decision panel of a flagged request has Reject, no Approve, and says why", () => {
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING", flagged: true }} />);

    expect(screen.queryByRole("button", { name: "Approve request" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reject request" })).toBeTruthy();
    expect(screen.getByText(/flagged, so it cannot be approved until the conflict is resolved. You can still reject it./)).toBeTruthy();
  });

  it("104-S4: an unflagged request still offers both and shows no explanation", () => {
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING", flagged: false }} />);
    expect(screen.getByRole("button", { name: "Approve request" })).toBeTruthy();
    expect(screen.queryByText(/flagged/)).toBeNull();
  });

  it("104-S4: a stale screen's approve is refused with the BOOKING_FLAGGED message, shown as the error", async () => {
    mockServer(409, { code: "BOOKING_FLAGGED", error: "This request is flagged and cannot be approved until the conflict is resolved. You can still reject it." });
    render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, approve" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("flagged and cannot be approved"));
    expect(refresh).not.toHaveBeenCalled();
  });
});

const listItem = (flags: FlagDto[]): VenueBookingListItem => ({
  id: "b-1", eventId: "evt-1", eventName: "Summit B", venueId: "ven-1", venueName: "Orchid Hall", date: "2030-11-14",
  startTime: "12:30", endTime: "14:00", status: "APPROVED", decidedAt: "2026-10-02T00:00:00.000Z", submittedAt: "2026-10-01T00:00:00.000Z", flags,
});

describe("SCRUM-104/AC3 the coordinator sees the flag and the other booking's time (104-S3)", () => {
  it("104-S3: the list row shows the flag as text with the other time, and the booking stays Approved", () => {
    render(<VenueBookingList bookings={[listItem([coordinatorFlag()])]} />);

    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText("Buffer conflict: another booking at this venue, 10:00 to 12:00 on 14 Nov")).toBeTruthy();
    expect(screen.queryByText(/Summit A/)).toBeNull();
  });

  it("104-S3: the event page's venue bookings show it too", () => {
    const booking: EventVenueBookingItem = {
      ...listItem([coordinatorFlag()]), rejectionReason: null, cancellationReason: null, expectedAttendance: 10, venueRequirements: null, exceedsCapacity: false,
    };
    render(<EventVenueBookings bookings={[booking]} />);
    expect(screen.getByText(/Buffer conflict: another booking at this venue, 10:00 to 12:00 on 14 Nov/)).toBeTruthy();
  });

  it("104-S3: the detail view shows it with how to resolve it", () => {
    const booking: VenueBookingDetailView = {
      ...listItem([coordinatorFlag()]), expectedAttendance: 10, venueRequirements: null, accessibilityNeeds: null, rejectionReason: null,
      suggestion: null, amendsRequestId: null, chain: [],
    };
    render(<VenueBookingDetail booking={booking} />);

    const banner = screen.getByLabelText("Flags");
    expect(banner.textContent).toContain("Buffer conflict: another booking at this venue, 10:00 to 12:00 on 14 Nov");
    expect(banner.textContent).toContain("Change or cancel this booking to resolve it.");
  });

  it("104-S3: an unflagged booking shows no flag text", () => {
    render(<VenueBookingList bookings={[listItem([])]} />);
    expect(screen.queryByText(/Buffer conflict/)).toBeNull();
  });
});

describe("SCRUM-104/AC3 the coordinator dashboard links to the venue bookings", () => {
  const data = (role: string): DashboardData => ({ user: { fullName: "Rachel Tan", email: "r@example.com", role }, sections: [] });

  it("104-S3: a coordinator gets My venue bookings", () => {
    render(<DashboardView data={data("event_coordinator")} />);
    expect(screen.getByRole("link", { name: "My venue bookings" }).getAttribute("href")).toBe("/venue-bookings");
  });

  it("104-S3: venue staff and organisers do not", () => {
    for (const role of ["venue_staff", "event_organiser"]) {
      const { unmount } = render(<DashboardView data={data(role)} />);
      expect(screen.queryByRole("link", { name: "My venue bookings" })).toBeNull();
      unmount();
    }
  });
});
