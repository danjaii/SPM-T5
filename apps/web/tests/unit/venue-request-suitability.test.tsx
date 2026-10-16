import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), redirect: vi.fn() }));

import { BookingQueueDetail } from "@/components/BookingQueueDetail";
import { BookingQueueList } from "@/components/BookingQueueList";
import { UnsuitableConfirm } from "@/components/UnsuitableConfirm";
import { VenueBookingActions } from "@/components/VenueBookingActions";
import { VenueBookingChangeForm } from "@/components/VenueBookingChangeForm";
import { VenueBookingRequestForm } from "@/components/VenueBookingRequestForm";
import type { QueueDetailView, QueueItemView } from "@/lib/bookingQueue";
import type { VenueBookingDetailView } from "@/lib/venueBookings";

// SCRUM-110 (docs/specs/venue-request-suitability.md): the warning before an unsuitable request is created, and the
// result venue staff see in their queue.

const REASON = "Organiser will run two smaller sessions";
const unmet = [
  { key: "capacity" as const, label: "Capacity", message: "Expected attendance 120 exceeds capacity 60" },
  { key: "layout" as const, label: "Layout", message: "Theatre not supported" },
];
const form = {
  eventId: "evt-1", eventName: "TechConf 2026", date: "2099-01-01", startTime: "09:00", endTime: "12:00",
  expectedAttendance: 120, venueRequirements: "Theatre", accessibilityNeeds: null,
};
const venues = [{ id: "ven-2", name: "Lotus Room", max_capacity: 60 }];

/** Replies to each fetch in turn: [status, body]. */
function replies(...answers: [number, unknown][]) {
  const fetchMock = vi.fn();
  for (const [status, body] of answers) fetchMock.mockResolvedValueOnce({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, call: number) => JSON.parse(fetchMock.mock.calls[call][1].body);
const warning = [409, { code: "UNSUITABLE_VENUE", error: "This venue does not meet all of the event's requirements.", unmet }] as [number, unknown];

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

describe("SCRUM-110/AC2, AC3 the confirm step (110-S2, 110-S3)", () => {
  it("110-S2: lists every unmet requirement and asks for a reason", () => {
    render(<UnsuitableConfirm unmet={unmet} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Expected attendance 120 exceeds capacity 60")).toBeTruthy();
    expect(within(dialog).getByText("Theatre not supported")).toBeTruthy();
    expect(within(dialog).getByLabelText("Reason for requesting it anyway")).toBeTruthy();
  });

  it("110-S2: Submit anyway needs a reason; a blank one is refused with a message and nothing is sent", () => {
    const onConfirm = vi.fn();
    render(<UnsuitableConfirm unmet={unmet} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit anyway" }));
    expect(screen.getByText("Enter a reason to continue.")).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("110-S2: the reason is passed on trimmed", () => {
    const onConfirm = vi.fn();
    render(<UnsuitableConfirm unmet={unmet} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Reason for requesting it anyway"), { target: { value: `  ${REASON} ` } });
    fireEvent.click(screen.getByRole("button", { name: "Submit anyway" }));
    expect(onConfirm).toHaveBeenCalledWith(REASON);
  });

  it("110-S3: Cancel calls onCancel and not onConfirm", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<UnsuitableConfirm unmet={unmet} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("SCRUM-110/AC1-AC3 the request form (110-S1, 110-S2, 110-S3, 110-S5)", () => {
  const chooseAndSubmit = () => {
    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "ven-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
  };

  it("110-S1: a suitable venue is requested straight away, with no warning", async () => {
    const fetchMock = replies([201, { id: "b-1", suitability: "suitable" }]);
    render(<VenueBookingRequestForm form={form} venues={venues} />);
    chooseAndSubmit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/venue-bookings/b-1"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock, 0)).not.toHaveProperty("overrideReason");
  });

  it("110-S2: an unsuitable venue shows the unmet requirements before anything is created", async () => {
    const fetchMock = replies(warning);
    render(<VenueBookingRequestForm form={form} venues={venues} />);
    chooseAndSubmit();

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Theatre not supported")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Submit request" })).toBeNull();
  });

  it("110-S2: Submit anyway repeats the request with the reason and goes to the new request", async () => {
    const fetchMock = replies(warning, [201, { id: "b-2", suitability: "not_suitable" }]);
    render(<VenueBookingRequestForm form={form} venues={venues} />);
    chooseAndSubmit();
    await screen.findByRole("alertdialog");

    fireEvent.change(screen.getByLabelText("Reason for requesting it anyway"), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Submit anyway" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/venue-bookings/b-2"));
    expect(bodyOf(fetchMock, 1)).toMatchObject({ venueId: "ven-2", overrideReason: REASON });
  });

  it("110-S3: Cancel closes the warning, returns to the form and creates nothing", async () => {
    const fetchMock = replies(warning);
    render(<VenueBookingRequestForm form={form} venues={venues} />);
    chooseAndSubmit();
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Submit request" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });

  it("110-S5: a taken slot is refused as an error with no way to continue", async () => {
    replies([409, { code: "SLOT_CONFLICT", error: "This venue is already held for part of that period." }]);
    render(<VenueBookingRequestForm form={form} venues={venues} />);
    chooseAndSubmit();

    expect((await screen.findByRole("alert")).textContent).toBe("This venue is already held for part of that period.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit anyway" })).toBeNull();
  });

  it("110-S6: the Check suitability button sends the booking's own attendance and layout", async () => {
    const fetchMock = replies([200, { venue: { id: "ven-2", name: "Lotus Room" }, event: { id: "evt-1", name: "TechConf 2026" }, overall: "suitable", criteria: [], manualChecks: [] }]);
    render(<VenueBookingRequestForm form={form} venues={venues} />);
    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "ven-2" } });
    fireEvent.change(screen.getByLabelText("Expected attendance for this venue"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Venue requirements for this venue"), { target: { value: "Boardroom" } });
    fireEvent.click(screen.getByRole("button", { name: "Check suitability" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.get("attendance")).toBe("40");
    expect(url.searchParams.get("venueRequirements")).toBe("Boardroom");
  });
});

describe("SCRUM-110/AC2 the same warning when changing a booking or accepting a suggestion (110-S8, 110-S10)", () => {
  const booking: VenueBookingDetailView = {
    id: "b-1", eventId: "evt-1", eventName: "TechConf 2026", venueId: "ven-2", venueName: "Lotus Room",
    date: "2099-01-01", startTime: "09:00", endTime: "12:00", status: "REJECTED", decidedAt: "2098-12-05T00:00:00.000Z",
    submittedAt: "2098-12-01T00:00:00.000Z", flags: [], expectedAttendance: 40, venueRequirements: null, accessibilityNeeds: null,
    rejectionReason: "Renovation", suggestion: { venueId: "ven-2", venueName: "Lotus Room", date: "2099-01-02", startTime: "09:00", endTime: "12:00" },
    amendsRequestId: null, chain: [],
  } as VenueBookingDetailView;

  it("110-S10: a change that no longer suits asks for a reason, then saves with it", async () => {
    const fetchMock = replies(warning, [200, { id: "b-1" }]);
    render(<VenueBookingChangeForm booking={{ ...booking, status: "APPROVED" }} equipment={[]} />);
    fireEvent.change(screen.getByLabelText("Expected attendance for this venue"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Save change" }));
    await screen.findByRole("alertdialog");
    expect(bodyOf(fetchMock, 0)).not.toHaveProperty("overrideReason");

    fireEvent.change(screen.getByLabelText("Reason for requesting it anyway"), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Submit anyway" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/evt-1"));
    expect(bodyOf(fetchMock, 1)).toMatchObject({ expectedAttendance: 300, overrideReason: REASON });
  });

  it("110-S8: accepting a suggestion for an unsuitable venue asks for a reason, then accepts it", async () => {
    const fetchMock = replies(warning, [201, { id: "b-9" }]);
    render(<VenueBookingActions booking={booking} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept suggested alternative" }));
    await screen.findByRole("alertdialog");

    fireEvent.change(screen.getByLabelText("Reason for requesting it anyway"), { target: { value: REASON } });
    fireEvent.click(screen.getByRole("button", { name: "Submit anyway" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/venue-bookings/b-9"));
    expect(bodyOf(fetchMock, 1)).toEqual({ overrideReason: REASON });
  });
});

describe("SCRUM-110/AC4 venue staff see the result (110-S4)", () => {
  const item = (over: Partial<QueueItemView> = {}): QueueItemView => ({
    id: "b-1", eventId: "evt-1", venueId: "ven-2", venueName: "Lotus Room", date: "2099-01-01", startTime: "09:00", endTime: "12:00",
    eventName: "TechConf 2026", expectedAttendance: 120, venueRequirements: "Theatre", accessibilityNeeds: null,
    requestedByName: "Rachel Tan", submittedAt: "2098-12-01T02:30:00.000Z", amendsRequestId: null, flags: [],
    suitability: "not_suitable", suitabilityUnmet: unmet, suitabilityOverrideReason: REASON, ...over,
  });
  const detail = (over: Partial<QueueDetailView> = {}): QueueDetailView => ({
    ...item(), status: "PENDING", decidedByName: null, decidedAt: null, rejectionReason: null, suggestion: null, ...over,
  });

  it("110-S4: the queue has a Suitability column saying Not suitable, Suitable or Not checked", () => {
    render(<BookingQueueList requests={[item(), item({ id: "b-2", suitability: "suitable", suitabilityUnmet: [], suitabilityOverrideReason: null }), item({ id: "b-3", suitability: null })]} />);
    expect(screen.getByRole("columnheader", { name: "Suitability" })).toBeTruthy();
    expect(screen.getByText("Not suitable")).toBeTruthy();
    expect(screen.getByText("Suitable")).toBeTruthy();
    expect(screen.getByText("Not checked")).toBeTruthy();
  });

  it("110-S4: opening it shows each unmet requirement and the coordinator's reason", () => {
    render(<BookingQueueDetail booking={detail()} />);
    expect(screen.getByText("Not suitable")).toBeTruthy();
    expect(screen.getByText("Expected attendance 120 exceeds capacity 60")).toBeTruthy();
    expect(screen.getByText("Theatre not supported")).toBeTruthy();
    expect(screen.getByText(REASON)).toBeTruthy();
  });

  it("110-S4: a suitable request shows no unmet list", () => {
    render(<BookingQueueDetail booking={detail({ suitability: "suitable", suitabilityUnmet: [], suitabilityOverrideReason: null })} />);
    expect(screen.queryByText("Requirements not met")).toBeNull();
  });
});
