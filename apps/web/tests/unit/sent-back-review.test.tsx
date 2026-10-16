import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import type { SentBackNote } from "@spm-t5/shared";
import { BookingQueueDetail } from "@/components/BookingQueueDetail";
import { BookingQueueList } from "@/components/BookingQueueList";
import { changeValue } from "@/components/EventChangeHistory";
import { EquipmentQueueList } from "@/components/EquipmentQueueList";
import { EquipmentRequestDetail } from "@/components/EquipmentRequestDetail";
import { EventEquipmentRequests } from "@/components/EventEquipmentRequests";
import { EventVenueBookings } from "@/components/EventVenueBookings";
import { SentBackNotice } from "@/components/SentBackNotice";
import type { QueueDetailView, QueueItemView } from "@/lib/bookingQueue";
import type { EquipmentQueueItemView, EquipmentRequestDetailView, EquipmentRequestView } from "@/lib/equipmentRequests";
import type { EventVenueBookingItem } from "@/lib/venueBookings";

// ----------------------------------------------------------------------------
// Test setup (docs/specs/send-back-affected-arrangements.md): a note of what changed on the event, sent back on
// 2 Oct 2026 at 11:00 Singapore time: the event moved from 12 to 13 Dec, attendance 480 to 600, venue requirements added.
// ----------------------------------------------------------------------------

const NOTE: SentBackNote = {
  sentBackAt: "2026-10-02T03:00:00.000Z",
  changes: [
    { field: "preferred_start_datetime", label: "Start", from: "2026-12-12T01:00:00.000Z", to: "2026-12-13T01:00:00.000Z" },
    { field: "expected_attendance", label: "Expected attendance", from: 480, to: 600 },
    { field: "venue_requirements", label: "Venue requirements", from: null, to: "Stage" },
  ],
};

const queueItem = (over: Partial<QueueItemView> = {}): QueueItemView => ({
  id: "b-1", eventId: "evt-1", suitability: null, suitabilityUnmet: [], suitabilityOverrideReason: null, venueId: "ven-1",
  venueName: "Orchid Hall", date: "2026-12-12", startTime: "10:00", endTime: "12:00", eventName: "Tech Summit",
  expectedAttendance: 480, venueRequirements: null, accessibilityNeeds: null, requestedByName: "Rachel Tan",
  submittedAt: "2026-10-01T02:30:00.000Z", amendsRequestId: null, flags: [], sentBack: null, ...over,
});

const queueDetail = (over: Partial<QueueDetailView> = {}): QueueDetailView => ({
  ...queueItem(), status: "PENDING", decidedByName: null, decidedAt: null, rejectionReason: null, suggestion: null, ...over,
});

const equipmentItem = (over: Partial<EquipmentQueueItemView> = {}): EquipmentQueueItemView => ({
  id: "req-1", eventId: "evt-1", eventName: "Tech Summit", eventDate: "2026-12-12", venueName: "Orchid Hall",
  equipment: "AV: Projector Unit", quantity: 2, status: "SUBMITTED", statusLabel: "Submitted", sentBack: null, ...over,
});

const equipmentDetail = (over: Partial<EquipmentRequestDetailView> = {}): EquipmentRequestDetailView => ({
  ...equipmentItem(), startTime: "10:00", endTime: "12:00", notes: null, reason: null, canReview: true, ...over,
});

const venueBooking = (over: Partial<EventVenueBookingItem> = {}): EventVenueBookingItem => ({
  id: "b-1", eventId: "evt-1", eventName: "Tech Summit", venueId: "ven-1", venueName: "Orchid Hall", date: "2026-12-12",
  startTime: "10:00", endTime: "12:00", status: "PENDING", decidedAt: null, submittedAt: "2026-10-01T00:00:00.000Z",
  rejectionReason: null, cancellationReason: null, expectedAttendance: 480, venueRequirements: null, exceedsCapacity: false,
  flags: [], sentBackForReview: false, ...over,
});

const equipmentRequest = (over: Partial<EquipmentRequestView> = {}): EquipmentRequestView => ({
  id: "req-1", equipment: "AV: Projector Unit", quantity: 2, venueName: "Orchid Hall", venueBookingId: "b-1", notes: null,
  status: "SUBMITTED", statusLabel: "Submitted", reason: null, releasedReason: null, sentBackForReview: false, ...over,
});

const SENT_BACK = "Sent back for review";

// end of test setup

describe("SCRUM-113/AC3 the note of what changed", () => {
  it("113-S7: says it was sent back, when, and each change as label: old → new, times as the change history shows them", () => {
    render(<SentBackNotice note={NOTE} />);

    const notice = within(screen.getByRole("region", { name: SENT_BACK }));
    expect(notice.getByText(/The event changed on 2026-10-02 11:00/)).toBeTruthy();
    const lines = notice.getAllByRole("listitem").map((li) => li.textContent);
    expect(lines).toEqual([
      `Start: ${changeValue("preferred_start_datetime", NOTE.changes[0].from)} → ${changeValue("preferred_start_datetime", NOTE.changes[0].to)}`,
      "Expected attendance: 480 → 600",
      "Venue requirements: (none) → Stage",
    ]);
  });

  it("113-S8: with no lines that concern it, it still says the event changed", () => {
    render(<SentBackNotice note={{ ...NOTE, changes: [] }} />);

    expect(screen.getByRole("region", { name: SENT_BACK }).textContent).toContain(
      "None of the changes concern this request directly; check it still suits the event.",
    );
  });

  it("113-S7: shows nothing when it was never sent back", () => {
    const { container } = render(<SentBackNotice note={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("SCRUM-113/AC3 Venue Staff (113-S7)", () => {
  it("113-S7: the queue marks a venue booking sent back for review, and only that one", () => {
    render(<BookingQueueList requests={[queueItem({ sentBack: NOTE }), queueItem({ id: "b-2", eventName: "Gala" })]} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain(SENT_BACK);
    expect(rows[1].textContent).not.toContain(SENT_BACK);
  });

  it("113-S7: the venue booking's page shows what changed", () => {
    render(<BookingQueueDetail booking={queueDetail({ sentBack: NOTE })} />);

    expect(within(screen.getByRole("region", { name: SENT_BACK })).getByText("Expected attendance: 480 → 600")).toBeTruthy();
  });
});

describe("SCRUM-113/AC3 Technical Support Staff (113-S8)", () => {
  it("113-S8: the queue marks an equipment request sent back for review, and only that one", () => {
    render(<EquipmentQueueList requests={[equipmentItem({ sentBack: NOTE }), equipmentItem({ id: "req-2" })]} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain(SENT_BACK);
    expect(rows[1].textContent).not.toContain(SENT_BACK);
  });

  it("113-S8: the equipment request's review page shows what changed", () => {
    render(<EquipmentRequestDetail request={equipmentDetail({ sentBack: NOTE })} />);

    expect(within(screen.getByRole("region", { name: SENT_BACK })).getByText("Expected attendance: 480 → 600")).toBeTruthy();
  });
});

describe("SCRUM-113/AC1, AC2 the coordinator's event page (113-S14)", () => {
  const WAITING = "Waiting for review again after an event change";

  it("113-S14: a venue booking sent back says it is waiting for review again; the others do not", () => {
    render(<EventVenueBookings bookings={[venueBooking({ sentBackForReview: true }), venueBooking({ id: "b-2", venueName: "Lotus Room" })]} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain(WAITING);
    expect(rows[1].textContent).not.toContain(WAITING);
  });

  it("113-S14: an equipment request sent back says it is waiting for review again; the others do not", () => {
    const requests = [equipmentRequest({ sentBackForReview: true }), equipmentRequest({ id: "req-2", equipment: "Audio: Microphone" })];
    render(<EventEquipmentRequests eventId="evt-1" data={{ requests, canCreate: false, readiness: null, readinessLabel: null }} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain(WAITING);
    expect(rows[1].textContent).not.toContain(WAITING);
  });
});
