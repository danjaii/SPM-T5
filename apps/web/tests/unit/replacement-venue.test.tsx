import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FlagDto, ReplacementCandidateDto } from "@spm-t5/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), redirect: vi.fn() }));

import { EventVenueBookings } from "@/components/EventVenueBookings";
import { ReplacementPicker } from "@/components/ReplacementPicker";
import { VenueBookingActions } from "@/components/VenueBookingActions";
import { VenueBookingDetail } from "@/components/VenueBookingDetail";
import { bookingActions, type EventVenueBookingItem, type VenueBookingDetailView } from "@/lib/venueBookings";

// SCRUM-107 (docs/specs/replacement-venue.md) on the web: Find replacement, the options, requesting one, and how the original
// and its replacement show each other. Words, not colour alone.

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

const flag: FlagDto = {
  id: "f-1",
  kind: "venue_unavailable",
  label: "Venue unavailable – alternative needed",
  createdAt: "2026-11-01T00:00:00.000Z",
  otherPeriod: null,
  unavailability: { startDate: "2030-11-14", startTime: "08:00", endDate: "2030-11-16", endTime: "18:00", reason: "maintenance", reasonLabel: "Maintenance" },
};

const detail = (over: Partial<VenueBookingDetailView> = {}): VenueBookingDetailView => ({
  id: "b-1", eventId: "evt-1", eventName: "TechConf 2026", venueId: "ven-1", venueName: "Orchid Hall", date: "2030-11-14",
  startTime: "09:00", endTime: "17:00", status: "APPROVED", decidedAt: "2026-10-02T00:00:00.000Z", submittedAt: "2026-10-01T00:00:00.000Z",
  flags: [flag], expectedAttendance: 120, venueRequirements: null, accessibilityNeeds: null, rejectionReason: null, suggestion: null,
  amendsRequestId: null, chain: [], replacedBy: null, replaces: null, flagHistory: [], ...over,
});

const lotus = { id: "b-2", venueName: "Lotus Room", date: "2030-11-14", startTime: "09:00", endTime: "17:00", status: "PENDING" };

describe("SCRUM-107/AC5, AC6 bookingActions offers Find replacement only where allowed", () => {
  it("107-S1: a flagged Approved booking with no replacement waiting", () => {
    expect(bookingActions(detail()).findReplacement).toBe(true);
  });

  it("107-S5: not while a replacement is Pending; offered again once it is no longer", () => {
    expect(bookingActions(detail({ replacedBy: lotus })).findReplacement).toBe(false);
    expect(bookingActions(detail({ replacedBy: { ...lotus, status: "REJECTED" } })).findReplacement).toBe(true);
  });

  it("107-S6: not for an unflagged booking, a buffer-conflict-only booking, or one that is replaced or rejected", () => {
    expect(bookingActions(detail({ flags: [] })).findReplacement).toBe(false);
    expect(bookingActions(detail({ flags: [{ ...flag, kind: "buffer_conflict", unavailability: undefined }] })).findReplacement).toBe(false);
    expect(bookingActions(detail({ status: "REPLACED", flags: [] })).findReplacement).toBe(false);
    expect(bookingActions(detail({ status: "REJECTED" })).findReplacement).toBe(false);
  });

  it("107-S1: the booking page shows a Find replacement link to the options, and none when it is not allowed", () => {
    const { unmount } = render(<VenueBookingActions booking={detail()} />);
    expect(screen.getByRole("link", { name: "Find replacement" }).getAttribute("href")).toBe("/venue-bookings/b-1/replacement");
    unmount();
    render(<VenueBookingActions booking={detail({ flags: [] })} />);
    expect(screen.queryByRole("link", { name: "Find replacement" })).toBeNull();
  });
});

describe("SCRUM-107/AC1, AC2 choosing a replacement (107-S1, 107-S2)", () => {
  const candidates: ReplacementCandidateDto[] = [
    { venueId: "ven-2", name: "Lotus Room", address: "2 Lotus Road", maxCapacity: 200 },
    { venueId: "ven-4", name: "Maple Hall", address: "4 Maple Road", maxCapacity: 300 },
  ];
  const mockServer = (status: number, body: unknown) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("107-S1: lists each venue with its location and capacity", () => {
    render(<ReplacementPicker originalId="b-1" candidates={candidates} />);
    expect(screen.getByText("Lotus Room")).toBeTruthy();
    expect(screen.getByText("4 Maple Road")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Request / })).toHaveLength(2);
  });

  it("107-S1: says so when nothing else is free", () => {
    render(<ReplacementPicker originalId="b-1" candidates={[]} />);
    expect(screen.getByText("No other venue is free for that period and big enough.")).toBeTruthy();
  });

  it("107-S2: Request this venue posts only the venue and goes to the new request", async () => {
    const fetchMock = mockServer(201, { id: "b-2", status: "PENDING", replaces: "b-1" });
    render(<ReplacementPicker originalId="b-1" candidates={candidates} />);

    fireEvent.click(screen.getByRole("button", { name: "Request Lotus Room" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/venue-bookings/b-2"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/venue-bookings\/b-1\/replacement$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ venueId: "ven-2" });
  });

  it("107-S2: a venue that does not suit the event asks for a reason, then sends it with the request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ code: "UNSUITABLE_VENUE", error: "x", unmet: [{ key: "capacity", label: "Capacity", message: "Too small" }] }) })
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: "b-2" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReplacementPicker originalId="b-1" candidates={candidates} />);

    fireEvent.click(screen.getByRole("button", { name: "Request Lotus Room" }));
    expect(await screen.findByText("This venue does not suit the event")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Smaller crowd expected" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit anyway" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/venue-bookings/b-2"));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ venueId: "ven-2", overrideReason: "Smaller crowd expected" });
  });

  it("107-S5: a refusal is shown as the message and nothing navigates", async () => {
    mockServer(409, { code: "REPLACEMENT_PENDING", error: "This booking already has a replacement request waiting for a decision." });
    render(<ReplacementPicker originalId="b-1" candidates={candidates} />);

    fireEvent.click(screen.getByRole("button", { name: "Request Maple Hall" }));

    expect(await screen.findByText("This booking already has a replacement request waiting for a decision.")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("SCRUM-107/AC3 the original and its replacement show each other (107-S3)", () => {
  it("107-S3: a REPLACED booking says Replaced by Lotus Room and keeps its flag history with the reason", () => {
    render(
      <VenueBookingDetail
        booking={detail({
          status: "REPLACED",
          flags: [],
          replacedBy: { ...lotus, status: "APPROVED" },
          flagHistory: [{ id: "f-1", kind: "venue_unavailable", label: flag.label, createdAt: flag.createdAt, resolvedAt: "2026-11-02T00:00:00.000Z", resolvedReason: "replaced", unavailability: flag.unavailability }],
        })}
      />,
    );

    expect(screen.getByText("Replaced")).toBeTruthy();
    const link = screen.getByRole("link", { name: /Lotus Room, 2030-11-14 09:00–17:00/ });
    expect(link.getAttribute("href")).toBe("/venue-bookings/b-2");
    expect(screen.getByRole("heading", { name: "Flag history" })).toBeTruthy();
    expect(screen.getByText(/Orchid Hall is unavailable from 14 Nov 08:00 to 16 Nov 18:00 \(Maintenance\): resolved \(replaced by another venue\)/)).toBeTruthy();
  });

  it("107-S3: a replacement says what it replaces", () => {
    render(<VenueBookingDetail booking={detail({ id: "b-2", venueName: "Lotus Room", status: "APPROVED", flags: [], replaces: { id: "b-1", venueName: "Orchid Hall", date: "2030-11-14", startTime: "09:00", endTime: "17:00", status: "REPLACED" } })} />);
    expect(screen.getByRole("link", { name: /Orchid Hall, 2030-11-14 09:00–17:00/ }).getAttribute("href")).toBe("/venue-bookings/b-1");
  });

  it("107-S5: a waiting replacement is named on the flagged booking", () => {
    render(<VenueBookingDetail booking={detail({ replacedBy: lotus })} />);
    expect(screen.getByText(/Replacement request waiting for a decision:/)).toBeTruthy();
  });

  it("107-S3: the event page shows REPLACED with Replaced by Lotus Room, and the replacement with Replaces Orchid Hall", () => {
    const base = { rejectionReason: null, cancellationReason: null, expectedAttendance: 120, venueRequirements: null, exceedsCapacity: false };
    const original: EventVenueBookingItem = { ...detail({ status: "REPLACED", flags: [] }), ...base, replacedBy: { ...lotus, status: "APPROVED" } };
    const next: EventVenueBookingItem = {
      ...detail({ id: "b-2", venueName: "Lotus Room", flags: [] }), ...base,
      replaces: { id: "b-1", venueName: "Orchid Hall", date: "2030-11-14", startTime: "09:00", endTime: "17:00", status: "REPLACED" },
    };
    render(<EventVenueBookings bookings={[original, next]} />);

    expect(screen.getByText("Replaced")).toBeTruthy();
    expect(screen.getByText(/Replaced by/).textContent).toContain("Lotus Room");
    expect(screen.getByText(/^Replaces/).textContent).toContain("Orchid Hall");
  });
});
