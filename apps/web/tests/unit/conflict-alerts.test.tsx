import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FlagDto } from "@spm-t5/shared";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { AffectedBookings } from "@/components/AffectedBookings";
import { NeedsAttentionBanner } from "@/components/NeedsAttentionBanner";
import { VenueBookingCard } from "@/components/VenueBookingCard";
import { VenueBookingDetail } from "@/components/VenueBookingDetail";
import type { EventVenueBookingItem, VenueBookingDetailView, VenueBookingListItem } from "@/lib/venueBookings";

// SCRUM-135: conflicts and affected bookings, as the coordinator sees them (Figma frames 06 and 16)

const conflict: FlagDto = {
  id: "f-1", kind: "buffer_conflict", label: "Buffer conflict", createdAt: "2026-10-15T00:00:00.000Z",
  otherPeriod: { date: "2030-11-14", startTime: "12:30", endTime: "14:00" },
};
const unavailable: FlagDto = {
  id: "f-2", kind: "venue_unavailable", label: "Venue unavailable – alternative needed", createdAt: "2026-10-15T00:00:00.000Z",
  otherPeriod: null,
  unavailability: { startDate: "2030-11-12", startTime: "00:00", endDate: "2030-11-16", endTime: "23:59", reason: "maintenance", reasonLabel: "Maintenance" },
};

const listItem = (over: Partial<VenueBookingListItem> = {}): VenueBookingListItem => ({
  id: "b-1", eventId: "evt-1", eventName: "Tech Summit", venueId: "v-1", venueName: "Hall B", date: "2030-11-14",
  startTime: "09:00", endTime: "17:00", status: "APPROVED", decidedAt: null, submittedAt: "2026-10-01T00:00:00.000Z", flags: [],
  ...over,
});
const eventItem = (over: Partial<EventVenueBookingItem> = {}): EventVenueBookingItem => ({
  ...listItem(), rejectionReason: null, cancellationReason: null, expectedAttendance: 60, venueRequirements: null, exceedsCapacity: false,
  ...over,
});

describe("SCRUM-135/AC1 conflict badge on a booking", () => {
  it("135-S1: an overlapping booking shows the Conflict badge (icon and label) and the other booking's time, never its event", () => {
    render(<VenueBookingCard booking={eventItem({ flags: [conflict] })} now={new Date("2030-11-01T00:00:00Z")} canChange={false} equipment={[]} />);
    const flags = screen.getByLabelText("Flags");
    const badge = within(flags).getByText("Conflict");
    expect(badge.closest("[data-tone]")?.getAttribute("data-tone")).toBe("danger");
    expect(within(flags).getByTestId("status-icon")).toBeTruthy();
    expect(flags.textContent).toContain("12:30 to 14:00 on 14 Nov");
  });

  it("135-S1: the booking's own page shows the same badge", () => {
    const booking: VenueBookingDetailView = { ...listItem({ flags: [conflict] }), expectedAttendance: 60, venueRequirements: null, accessibilityNeeds: null, rejectionReason: null, suggestion: null, amendsRequestId: null, chain: [] };
    render(<VenueBookingDetail booking={booking} />);
    expect(within(screen.getByLabelText("Flags")).getByText("Conflict")).toBeTruthy();
  });

  it("135-S1: an unflagged booking has no badge", () => {
    render(<VenueBookingCard booking={eventItem()} now={new Date("2030-11-01T00:00:00Z")} canChange={false} equipment={[]} />);
    expect(screen.queryByLabelText("Flags")).toBeNull();
  });
});

describe("SCRUM-135/AC2 affected bookings on the home page", () => {
  it("135-S2: lists a booking a venue change put in doubt, and says nothing was removed by keeping it as a link", () => {
    render(<AffectedBookings bookings={[listItem({ flags: [unavailable] })]} />);
    const row = screen.getByTestId("affected-booking");
    expect(within(row).getByText("Tech Summit")).toBeTruthy();
    expect(within(row).getByText("Venue unavailable")).toBeTruthy();
  });

  it("135-S2: only holding bookings with a flag are listed; clean and closed ones are not", () => {
    render(<AffectedBookings bookings={[
      listItem({ id: "a", eventName: "Flagged", flags: [conflict] }),
      listItem({ id: "b", eventName: "Clean" }),
      listItem({ id: "c", eventName: "Replaced", status: "REPLACED", flags: [unavailable] }),
    ]} />);
    const rows = screen.getAllByTestId("affected-booking");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain("Flagged");
  });

  it("135-S2/AC10: nothing affected says so; a failed load says why", () => {
    const { rerender } = render(<AffectedBookings bookings={[]} />);
    expect(screen.getByText("No bookings need attention.")).toBeTruthy();
    rerender(<AffectedBookings error="We couldn't load your venue booking requests." />);
    expect(screen.getByRole("alert").textContent).toContain("couldn't load");
  });
});

describe("SCRUM-135/AC3 Find replacement venue", () => {
  it("135-S3: an unavailable venue offers Find replacement venue, linking to that booking's replacement search", () => {
    render(<AffectedBookings bookings={[listItem({ flags: [unavailable] })]} />);
    const link = screen.getByRole("link", { name: /Find replacement venue/ });
    expect(link.getAttribute("href")).toBe("/venue-bookings/b-1/replacement");
  });

  it("135-S3: a conflict has no replacement search (the server refuses it), so it links to the booking instead", () => {
    render(<AffectedBookings bookings={[listItem({ flags: [conflict] })]} />);
    expect(screen.queryByRole("link", { name: /Find replacement venue/ })).toBeNull();
    expect(screen.getByRole("link", { name: /View the Hall B booking/ }).getAttribute("href")).toBe("/venue-bookings/b-1");
  });

  it("135-S3: the banner on the event page has the same button, and says the booking is kept", () => {
    render(<NeedsAttentionBanner bookings={[eventItem({ flags: [unavailable] })]} />);
    const banner = screen.getByTestId("needs-attention-banner");
    expect(within(banner).getByText("Hall B needs attention")).toBeTruthy();
    expect(banner.textContent).toContain("The booking and event details are kept.");
    expect(within(banner).getByRole("link", { name: "Find replacement venue" }).getAttribute("href")).toBe("/venue-bookings/b-1/replacement");
  });

  it("135-S3: no banner when nothing is flagged", () => {
    const { container } = render(<NeedsAttentionBanner bookings={[eventItem()]} />);
    expect(container.firstChild).toBeNull();
  });
});
