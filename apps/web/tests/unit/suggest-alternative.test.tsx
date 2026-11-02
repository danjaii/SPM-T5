import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, refresh, getQueuedBooking, getSuitability, getVenues } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  getQueuedBooking: vi.fn(),
  getSuitability: vi.fn(),
  getVenues: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), redirect: vi.fn() }));
vi.mock("@/lib/bookingQueueServer", () => ({ getQueuedBooking }));
vi.mock("@/lib/venueSuitabilityServer", () => ({ getSuitability }));
vi.mock("@/lib/getVenues", () => ({ getVenues }));
vi.mock("@/components/BookingQueueDetail", () => ({ BookingQueueDetail: () => <p>request detail</p> }));
vi.mock("@/components/SuitabilityReport", () => ({ SuitabilityReport: () => <p>suitability</p> }));

import QueuedBookingPage from "@/app/booking-queue/[id]/page";
import { VenueStaffDecision } from "@/components/VenueStaffDecision";
import { rejectVenueBooking } from "@/lib/venueBookings";

// SCRUM-40 (docs/specs/venue-booking-suggestion.md): the Reject dialog's optional "Suggest an alternative". The same shared parser as
// venue-service checks it, so a problem is named on its field before anything is sent.
const VENUES = [
  { id: "venue-1", name: "Orchid Hall" },
  { id: "venue-2", name: "Lotus Room" },
];
const REASON = "Room under renovation";

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** What the last fetch sent, parsed. */
const sent = (fetchMock: ReturnType<typeof vi.fn>) => JSON.parse(fetchMock.mock.calls[0][1].body as string);

function openReject(venues: typeof VENUES | null = VENUES) {
  render(<VenueStaffDecision booking={{ id: "b-1", status: "PENDING" }} venues={venues ?? undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
  return within(screen.getByRole("dialog"));
}

/** Types the reason, ticks Suggest an alternative and fills the four fields (the date is far in the future). */
function fillSuggestion(dialog: ReturnType<typeof within>, over: Partial<Record<"venue" | "date" | "start" | "end", string>> = {}) {
  fireEvent.change(dialog.getByLabelText("Reason for rejection"), { target: { value: REASON } });
  fireEvent.click(dialog.getByRole("checkbox", { name: "Suggest an alternative" }));
  fireEvent.change(dialog.getByLabelText("Suggested venue"), { target: { value: over.venue ?? "venue-2" } });
  fireEvent.change(dialog.getByLabelText("Suggested date"), { target: { value: over.date ?? "2099-11-15" } });
  fireEvent.change(dialog.getByLabelText("Suggested start time"), { target: { value: over.start ?? "09:00" } });
  fireEvent.change(dialog.getByLabelText("Suggested end time"), { target: { value: over.end ?? "17:00" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

describe("SCRUM-40/AC1 rejecting with a suggested alternative (40-S1)", () => {
  it("40-S1: sends the reason with the suggested venue, date and times, then refreshes the page", async () => {
    const fetchMock = mockServer(200, { id: "b-1", status: "REJECTED" });
    const dialog = openReject();

    fillSuggestion(dialog);
    fireEvent.click(dialog.getByRole("button", { name: "Reject request" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/venue-bookings\/b-1\/reject$/);
    expect(sent(fetchMock)).toEqual({
      reason: REASON,
      suggestion: { venueId: "venue-2", date: "2099-11-15", startTime: "09:00", endTime: "17:00" },
    });
  });

  it("40-S1: the venue choices are the catalogue's venues, with a prompt first", () => {
    const dialog = openReject();
    fireEvent.click(dialog.getByRole("checkbox", { name: "Suggest an alternative" }));

    const options = within(dialog.getByLabelText("Suggested venue")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose a venue", "Orchid Hall", "Lotus Room"]);
    expect(dialog.getByText(/does not hold the venue for them/)).toBeTruthy();
  });

  it("40-S1: the same venue at another time can be suggested", async () => {
    const fetchMock = mockServer(200, {});
    const dialog = openReject();

    fillSuggestion(dialog, { venue: "venue-1", date: "2099-12-01" });
    fireEvent.click(dialog.getByRole("button", { name: "Reject request" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(sent(fetchMock).suggestion).toMatchObject({ venueId: "venue-1", date: "2099-12-01" });
  });
});

describe("SCRUM-40/AC2 the suggestion is optional (40-S2)", () => {
  it("40-S2: the suggestion is closed by default, and a rejection with only a reason sends just the reason", async () => {
    const fetchMock = mockServer(200, {});
    const dialog = openReject();

    expect(dialog.queryByLabelText("Suggested venue")).toBeNull();
    fireEvent.change(dialog.getByLabelText("Reason for rejection"), { target: { value: REASON } });
    fireEvent.click(dialog.getByRole("button", { name: "Reject request" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent(fetchMock)).toEqual({ reason: REASON });
  });

  it("40-S2: ticking Suggest an alternative and leaving it empty is no suggestion", async () => {
    const fetchMock = mockServer(200, {});
    const dialog = openReject();

    fireEvent.change(dialog.getByLabelText("Reason for rejection"), { target: { value: REASON } });
    fireEvent.click(dialog.getByRole("checkbox", { name: "Suggest an alternative" }));
    fireEvent.click(dialog.getByRole("button", { name: "Reject request" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent(fetchMock)).toEqual({ reason: REASON });
  });

  it("40-S2: without a list of venues the dialog offers no suggestion at all", () => {
    const dialog = openReject(null);

    expect(dialog.queryByRole("checkbox", { name: "Suggest an alternative" })).toBeNull();
    expect(dialog.getByLabelText("Reason for rejection")).toBeTruthy();
  });

  it("40-S2: an empty list of venues offers none either", () => {
    expect(openReject([]).queryByRole("checkbox", { name: "Suggest an alternative" })).toBeNull();
  });
});

describe("SCRUM-40/AC1 a suggestion that is not right is named on its field (40-S4)", () => {
  it("40-S4: a venue with no date or times names each missing field and sends nothing", () => {
    const fetchMock = mockServer(200, {});
    const dialog = openReject();

    fireEvent.change(dialog.getByLabelText("Reason for rejection"), { target: { value: REASON } });
    fireEvent.click(dialog.getByRole("checkbox", { name: "Suggest an alternative" }));
    fireEvent.change(dialog.getByLabelText("Suggested venue"), { target: { value: "venue-2" } });
    fireEvent.click(dialog.getByRole("button", { name: "Reject request" }));

    expect(dialog.getByText("Enter a date.")).toBeTruthy();
    expect(dialog.getByText("Enter a start time.")).toBeTruthy();
    expect(dialog.getByText("Enter an end time.")).toBeTruthy();
    expect(dialog.getByRole("alert").textContent).toContain("Some details of the suggested alternative need fixing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("40-S4: times with no venue, an end before the start and a start in the past are each refused on their field", () => {
    const fetchMock = mockServer(200, {});
    const dialog = openReject();

    fillSuggestion(dialog, { venue: "" });
    fireEvent.click(dialog.getByRole("button", { name: "Reject request" }));
    expect(dialog.getByText("Choose a venue.")).toBeTruthy();

    fireEvent.change(dialog.getByLabelText("Suggested venue"), { target: { value: "venue-2" } });
    fireEvent.change(dialog.getByLabelText("Suggested start time"), { target: { value: "17:00" } });
    fireEvent.change(dialog.getByLabelText("Suggested end time"), { target: { value: "09:00" } });
    fireEvent.click(dialog.getByRole("button", { name: "Reject request" }));
    expect(dialog.getByText("End time must be after the start time.")).toBeTruthy();

    fireEvent.change(dialog.getByLabelText("Suggested start time"), { target: { value: "09:00" } });
    fireEvent.change(dialog.getByLabelText("Suggested end time"), { target: { value: "17:00" } });
    fireEvent.change(dialog.getByLabelText("Suggested date"), { target: { value: "2020-01-01" } });
    fireEvent.click(dialog.getByRole("button", { name: "Reject request" }));
    expect(dialog.getByText("The start time must not be in the past.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("40-S4: a message goes away when its field is changed", () => {
    mockServer(200, {});
    const dialog = openReject();

    fillSuggestion(dialog, { date: "" });
    fireEvent.click(dialog.getByRole("button", { name: "Reject request" }));
    expect(dialog.getByText("Enter a date.")).toBeTruthy();
    expect(dialog.getByRole("alert").textContent).toContain("Some details of the suggested alternative need fixing");
    fireEvent.change(dialog.getByLabelText("Suggested date"), { target: { value: "2099-11-15" } });

    expect(dialog.queryByText("Enter a date.")).toBeNull();
    expect(dialog.queryByRole("alert")).toBeNull(); // the summary goes with the problem it described
  });

  it("40-S4: a reason the server gives for the venue is shown on the venue field, and nothing is refreshed", async () => {
    mockServer(422, { code: "VALIDATION_FAILED", error: "Some fields are invalid.", fieldErrors: { "suggestion.venueId": "Choose a venue from the list." } });
    const dialog = openReject();

    fillSuggestion(dialog);
    fireEvent.click(dialog.getByRole("button", { name: "Reject request" }));

    expect(await dialog.findByText("Choose a venue from the list.")).toBeTruthy();
    expect(dialog.getByRole("alert").textContent).toContain("Some details of the suggested alternative need fixing");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("40-S4: the reason is still required, so a good suggestion alone does not allow the rejection", () => {
    const fetchMock = mockServer(200, {});
    const dialog = openReject();

    fillSuggestion(dialog);
    fireEvent.change(dialog.getByLabelText("Reason for rejection"), { target: { value: "   " } });

    expect((dialog.getByRole("button", { name: "Reject request" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("40-S4: cancelling the dialog sends nothing", () => {
    const fetchMock = mockServer(200, {});
    const dialog = openReject();

    fillSuggestion(dialog);
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("SCRUM-40 the call to venue-service and the page that supplies the venues", () => {
  it("40-S1: rejectVenueBooking sends the suggestion only when there is one", async () => {
    const fetchMock = mockServer(200, {});

    await rejectVenueBooking("b/1", REASON, { venueId: "venue-2", date: "2099-11-15", startTime: "09:00", endTime: "17:00" });
    await rejectVenueBooking("b/1", REASON);

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/venue-bookings\/b%2F1\/reject$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      reason: REASON,
      suggestion: { venueId: "venue-2", date: "2099-11-15", startTime: "09:00", endTime: "17:00" },
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ reason: REASON });
  });

  const queued = { id: "b-1", status: "PENDING", flags: [], venueId: "venue-1", eventId: "e-1", date: "2099-11-14", startTime: "09:00", endTime: "17:00", expectedAttendance: 40 };

  it("40-S1: the booking queue page gives the Reject dialog the venue catalogue to suggest from", async () => {
    getQueuedBooking.mockResolvedValue({ booking: queued });
    getSuitability.mockResolvedValue(null);
    getVenues.mockResolvedValue({ venues: [{ id: "venue-1", name: "Orchid Hall", address: "L3", max_capacity: 150 }, { id: "venue-2", name: "Lotus Room", address: "L4", max_capacity: 80 }] });

    render(await QueuedBookingPage({ params: Promise.resolve({ id: "b-1" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Reject request" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("checkbox", { name: "Suggest an alternative" }));

    const options = within(screen.getByLabelText("Suggested venue")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose a venue", "Orchid Hall", "Lotus Room"]);
  });

  it("40-S2: when the venues cannot be loaded, the page still lets Venue Staff reject, with no suggestion section", async () => {
    getQueuedBooking.mockResolvedValue({ booking: queued });
    getSuitability.mockResolvedValue(null);
    getVenues.mockResolvedValue({ error: "We couldn't load the venue catalogue." });

    render(await QueuedBookingPage({ params: Promise.resolve({ id: "b-1" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Reject request" }));

    expect(within(screen.getByRole("dialog")).queryByRole("checkbox", { name: "Suggest an alternative" })).toBeNull();
    expect(within(screen.getByRole("dialog")).getByLabelText("Reason for rejection")).toBeTruthy();
  });

  it("40-S2: a request that could not be loaded shows its error and does not ask for venues", async () => {
    getQueuedBooking.mockResolvedValue({ error: "Venue booking request not found." });
    getVenues.mockClear();

    render(await QueuedBookingPage({ params: Promise.resolve({ id: "nope" }) }));

    expect(screen.getByRole("alert").textContent).toBe("Venue booking request not found.");
    expect(getVenues).not.toHaveBeenCalled();
  });
});
