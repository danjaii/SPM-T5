import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), redirect: vi.fn() }));

import { VenueBookingActions } from "@/components/VenueBookingActions";
import { VenueBookingAmendForm } from "@/components/VenueBookingAmendForm";
import { bookingActions, type VenueBookingDetailView } from "@/lib/venueBookings";

const detail = (over: Partial<VenueBookingDetailView> = {}): VenueBookingDetailView => ({
  id: "b-1", eventId: "evt-1", eventName: "Tech Summit", venueId: "ven-1", venueName: "Grand Hall",
  date: "2099-01-01", startTime: "09:00", endTime: "12:00", status: "PENDING",
  decidedAt: null, submittedAt: "2098-12-01T00:00:00.000Z", flags: [],
  expectedAttendance: 120, venueRequirements: "Projector", accessibilityNeeds: null,
  rejectionReason: null, suggestion: null, amendsRequestId: null, chain: [],
  ...over,
});
const suggestion = { venueId: "ven-2", venueName: "Lotus Room", date: "2099-01-02", startTime: "09:00", endTime: "12:00" };
const rejected = (over: Partial<VenueBookingDetailView> = {}) =>
  detail({ status: "REJECTED", rejectionReason: "Renovation", decidedAt: "2098-12-05T00:00:00.000Z", ...over });

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

describe("SCRUM-35/AC2, SCRUM-60/AC4, SCRUM-59/AC4 actions are offered only where allowed", () => {
  it.each(["APPROVED", "REJECTED", "WITHDRAWN"] as const)("35-S2: no withdraw for %s", (status) => {
    expect(bookingActions(detail({ status })).withdraw).toBe(false);
  });

  it("35-S2: a pending request can be withdrawn but not amended or accepted", () => {
    expect(bookingActions(detail({ suggestion }))).toEqual({ withdraw: true, amend: false, acceptSuggestion: false, findReplacement: false });
  });

  it.each(["PENDING", "APPROVED", "WITHDRAWN"] as const)("60-S4 / 59-S4: nothing to amend or accept for %s", (status) => {
    const actions = bookingActions(detail({ status, suggestion }));
    expect(actions.amend).toBe(false);
    expect(actions.acceptSuggestion).toBe(false);
  });

  it("60-S4: a rejected request can be amended; 59-S4: accept needs a suggestion", () => {
    expect(bookingActions(rejected())).toEqual({ withdraw: false, amend: true, acceptSuggestion: false, findReplacement: false });
    expect(bookingActions(rejected({ suggestion }))).toEqual({ withdraw: false, amend: true, acceptSuggestion: true, findReplacement: false });
  });

  it("60-S5: hidden while a later amendment is still active", () => {
    const later = { ...detail({ id: "b-2", status: "PENDING" }), rejectionReason: null };
    expect(bookingActions(rejected({ suggestion, chain: [{ ...rejected(), rejectionReason: "Renovation" }, later] }))).toEqual({
      withdraw: false, amend: false, acceptSuggestion: false, findReplacement: false,
    });
  });

  it("renders nothing when no action is available", () => {
    const { container } = render(<VenueBookingActions booking={detail({ status: "APPROVED" })} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("SCRUM-35/AC1 withdrawing (35-S1)", () => {
  it("35-S1: asks to confirm, then withdraws and refreshes", async () => {
    const fetchMock = mockServer(200, { id: "b-1" });
    render(<VenueBookingActions booking={detail()} />);

    fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Yes, withdraw" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4003/venue-bookings/b-1/withdraw");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  it("keeping the request cancels the confirmation without calling the server", () => {
    const fetchMock = mockServer(200, {});
    render(<VenueBookingActions booking={detail()} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep request" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("35-S5: shows the server's refusal when the request was decided in the meantime", async () => {
    mockServer(409, { code: "NOT_PENDING", error: "This request is no longer pending." });
    render(<VenueBookingActions booking={detail()} />);
    fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, withdraw" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This request is no longer pending.");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("SCRUM-59/AC1 accepting the suggested alternative (59-S1)", () => {
  it("59-S1: accepts in one action and opens the new request", async () => {
    const fetchMock = mockServer(201, { id: "b-9" });
    render(<VenueBookingActions booking={rejected({ suggestion })} />);

    fireEvent.click(screen.getByRole("button", { name: "Accept suggested alternative" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/venue-bookings/b-9"));
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4003/venue-bookings/b-1/accept-suggestion");
  });

  it("59-S2 / 59-S3: shows the refusal and leaves the screen as it was", async () => {
    mockServer(409, { code: "SLOT_CONFLICT", error: "This venue is already held for part of that period." });
    render(<VenueBookingActions booking={rejected({ suggestion })} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept suggested alternative" }));

    expect((await screen.findByRole("alert")).textContent).toContain("already held");
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Amend request" })).toBeTruthy();
  });

  it("falls back to a generic message when the server gives none", async () => {
    mockServer(500, {});
    render(<VenueBookingActions booking={rejected({ suggestion })} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept suggested alternative" }));
    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't complete that. Please try again.");
  });
});

describe("SCRUM-60/AC1 amending a rejected request (60-S1)", () => {
  it("60-S4: a rejected request links to the amend screen", () => {
    render(<VenueBookingActions booking={rejected()} />);
    expect(screen.getByRole("link", { name: "Amend request" }).getAttribute("href")).toBe("/venue-bookings/b-1/amend");
  });

  const form = {
    eventId: "evt-1", eventName: "Tech Summit", date: "2099-05-05", startTime: "10:00", endTime: "11:00",
    expectedAttendance: 120, venueRequirements: "Projector", accessibilityNeeds: null,
  };
  const venues = [{ id: "ven-1", name: "Grand Hall", max_capacity: 200 }, { id: "ven-2", name: "Lotus Room", max_capacity: 100 }];

  it("60-S1: starts from the rejected slot and submits an amendment to the rejected request", async () => {
    const fetchMock = mockServer(201, { id: "b-2" });
    render(<VenueBookingAmendForm rejected={rejected()} form={form} venues={venues} />);

    expect((screen.getByLabelText("Venue") as HTMLSelectElement).value).toBe("ven-1");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2099-01-01");
    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "ven-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit amended request" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/venue-bookings/b-2"));
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:4003/venue-bookings/b-1/amend");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      venueId: "ven-2", date: "2099-01-01", startTime: "09:00", endTime: "12:00",
    });
  });

  it("60-S2: shows the server's refusal for a repeat of a rejected slot", async () => {
    mockServer(409, { code: "REPEAT_OF_REJECTED", error: "That slot was already rejected. Choose a different venue, date or time." });
    render(<VenueBookingAmendForm rejected={rejected()} form={form} venues={venues} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit amended request" }));

    expect((await screen.findByRole("alert")).textContent).toContain("already rejected");
    expect(push).not.toHaveBeenCalled();
  });
});
