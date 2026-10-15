import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), redirect: vi.fn() }));

const { getVenueBooking, getEventEquipmentRequests } = vi.hoisted(() => ({ getVenueBooking: vi.fn(), getEventEquipmentRequests: vi.fn() }));
vi.mock("@/lib/venueBookingsServer", () => ({ getVenueBooking }));
vi.mock("@/lib/equipmentRequestsServer", () => ({ getEventEquipmentRequests }));

import ChangeVenueBookingPage from "@/app/venue-bookings/[id]/change/page";
import { VenueBookingCancel } from "@/components/VenueBookingCancel";
import { VenueBookingChangeForm } from "@/components/VenueBookingChangeForm";
import type { EquipmentRequestView } from "@/lib/equipmentRequests";
import { equipmentFor, isChangeableVenueBooking, type EventVenueBookingItem, type VenueBookingDetailView } from "@/lib/venueBookings";

// ----------------------------------------------------------------------------
// Test setup: Orchid Hall's venue booking for "Tech Summit" on 14 Nov 2030, 9am-12pm, with 2 projectors requested for it
// (docs/specs/change-cancel-venue-booking.md)
// ----------------------------------------------------------------------------

const listItem = (over: Partial<EventVenueBookingItem> = {}): EventVenueBookingItem => ({
  id: "b-1",
  eventId: "evt-1",
  eventName: "Tech Summit",
  venueId: "ven-1",
  venueName: "Orchid Hall",
  date: "2030-11-14",
  startTime: "09:00",
  endTime: "12:00",
  status: "APPROVED",
  decidedAt: null,
  submittedAt: "2026-10-01T00:00:00.000Z",
  rejectionReason: null,
  cancellationReason: null,
  expectedAttendance: 120,
  venueRequirements: "Theatre",
  exceedsCapacity: false,
  ...over,
});

const detail = (over: Partial<VenueBookingDetailView> = {}): VenueBookingDetailView => ({
  id: "b-1",
  eventId: "evt-1",
  eventName: "Tech Summit",
  venueId: "ven-1",
  venueName: "Orchid Hall",
  date: "2030-11-14",
  startTime: "09:00",
  endTime: "12:00",
  status: "APPROVED",
  decidedAt: null,
  submittedAt: "2026-10-01T00:00:00.000Z",
  expectedAttendance: 120,
  venueRequirements: "Theatre",
  accessibilityNeeds: null,
  rejectionReason: null,
  suggestion: null,
  amendsRequestId: null,
  chain: [],
  ...over,
});

const projectors: EquipmentRequestView = {
  id: "e-1",
  equipment: "AV: Projector Unit",
  quantity: 2,
  venueName: "Orchid Hall",
  venueBookingId: "b-1",
  notes: null,
  status: "ARRANGED",
  statusLabel: "Arranged",
  releasedReason: null,
  reason: null,
  equipmentId: "eq-projector",
  canEdit: false,
  lastChangedBy: null,
  lastChangedAt: null,
};

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

const openCancel = () => fireEvent.click(screen.getByRole("button", { name: "Cancel the Orchid Hall venue booking" }));
const typeReason = (text: string) => fireEvent.change(screen.getByLabelText("Reason for cancelling"), { target: { value: text } });

// end of test setup

// ----------------------------------------------------------------------------
// SCRUM-102/AC4 confirm before cancelling; AC7 the equipment that is released with it
// ----------------------------------------------------------------------------

describe("SCRUM-102/AC4, AC7 the cancel confirmation (102-S18, 102-S19, 102-S29)", () => {
  it("102-S18 pressing Cancel asks first: it names the venue booking and asks for a reason, and sends nothing yet", () => {
    const fetchMock = mockServer(200, {});
    render(<VenueBookingCancel booking={listItem()} equipment={[]} />);

    openCancel();

    const dialog = screen.getByRole("alertdialog", { name: "Cancel venue booking" });
    expect(dialog.textContent).toContain("Orchid Hall, 2030-11-14, 09:00–12:00");
    expect(within(dialog).getByLabelText("Reason for cancelling")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("102-S19 Go back closes the confirmation, sends nothing, and offers Cancel again", () => {
    const fetchMock = mockServer(200, {});
    render(<VenueBookingCancel booking={listItem()} equipment={[projectors]} />);
    openCancel();
    typeReason("Moved");

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    openCancel();
    expect((screen.getByLabelText("Reason for cancelling") as HTMLTextAreaElement).value).toBe(""); // starts afresh
  });

  // no choice to make about the equipment, so it is a statement and the button says what will happen
  it("102-S29 with equipment requested for it, lists the equipment and the button says it is released", () => {
    render(<VenueBookingCancel booking={listItem()} equipment={[projectors]} />);
    openCancel();

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("This also releases the equipment requested for it:")).toBeTruthy();
    expect(within(dialog).getByText("2 × AV: Projector Unit (Arranged)")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel venue booking and release equipment" })).toBeTruthy();
  });

  it("102-S29 with no equipment requested for it, says nothing about equipment and the button just cancels", () => {
    render(<VenueBookingCancel booking={listItem()} equipment={[]} />);
    openCancel();

    expect(screen.queryByText(/releases the equipment/)).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel venue booking" })).toBeTruthy();
  });

  it.each([
    ["no reason", "", "Enter a reason for cancelling."],
    ["only spaces", "   ", "Enter a reason for cancelling."],
    ["501 characters", "x".repeat(501), "The reason must be 500 characters or fewer."],
  ])("102-S13 with %s, shows the shared message and sends nothing", (_name, text, message) => {
    const fetchMock = mockServer(200, {});
    render(<VenueBookingCancel booking={listItem()} equipment={[]} />);
    openCancel();
    typeReason(text);

    fireEvent.click(screen.getByRole("button", { name: "Cancel venue booking" }));

    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("102-S12 confirming cancels it with the trimmed reason and refreshes the event page", async () => {
    const fetchMock = mockServer(200, { id: "b-1", status: "CANCELLED" });
    render(<VenueBookingCancel booking={listItem({ id: "b 1" })} equipment={[projectors]} />);
    openCancel();
    typeReason("  Moved to a bigger room  ");

    fireEvent.click(screen.getByRole("button", { name: "Cancel venue booking and release equipment" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4003/venue-bookings/b%201/cancel");
    expect(options).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(options.body)).toEqual({ reason: "Moved to a bigger room" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("102-S11 shows venue-service's refusal and keeps the confirmation open", async () => {
    mockServer(409, { code: "NOT_ACTIVE", error: "Only a pending or approved venue booking can be changed or cancelled." });
    render(<VenueBookingCancel booking={listItem()} equipment={[]} />);
    openCancel();
    typeReason("Moved");

    fireEvent.click(screen.getByRole("button", { name: "Cancel venue booking" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Only a pending or approved venue booking can be changed or cancelled.");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("falls back to a general message when the server can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    render(<VenueBookingCancel booking={listItem()} equipment={[]} />);
    openCancel();
    typeReason("Moved");

    fireEvent.click(screen.getByRole("button", { name: "Cancel venue booking" }));

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't reach the server. Please try again.");
  });
});

// ----------------------------------------------------------------------------
// SCRUM-102/AC1 the change form; AC8 the equipment that moves with it
// ----------------------------------------------------------------------------

describe("SCRUM-102/AC1, AC8 the change form (102-S27, 102-S35)", () => {
  const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Save change" }));

  it("102-S27 starts from the venue booking's date, times, attendance and requirements; the venue is shown but not editable", () => {
    render(<VenueBookingChangeForm booking={detail()} equipment={[]} />);

    expect(field("Date").value).toBe("2030-11-14");
    expect(field("Start time").value).toBe("09:00");
    expect(field("End time").value).toBe("12:00");
    expect(field("Expected attendance for this venue").value).toBe("120");
    expect(field("Venue requirements for this venue").value).toBe("Theatre");
    expect(screen.getByText("Orchid Hall")).toBeTruthy();
    expect(screen.queryByLabelText("Venue")).toBeNull();
    expect(screen.getByText("The changed venue booking goes back to venue staff for approval.")).toBeTruthy();
  });

  it("102-S27 a venue booking with no attendance or requirements of its own starts with them empty", () => {
    render(<VenueBookingChangeForm booking={detail({ expectedAttendance: null, venueRequirements: null })} equipment={[]} />);

    expect(field("Expected attendance for this venue").value).toBe("");
    expect(field("Venue requirements for this venue").value).toBe("");
  });

  it("102-S35 with equipment requested for it, says the equipment moves and goes back to Technical Support Staff", () => {
    render(<VenueBookingChangeForm booking={detail()} equipment={[projectors]} />);

    const note = screen.getByRole("note");
    expect(note.textContent).toContain("A new date or time moves this equipment with it and sends it back to Technical Support Staff for review:");
    expect(within(note).getByText("2 × AV: Projector Unit (Arranged)")).toBeTruthy();
  });

  it("102-S35 with no equipment requested for it, says nothing about equipment", () => {
    render(<VenueBookingChangeForm booking={detail()} equipment={[]} />);

    expect(screen.queryByRole("note")).toBeNull();
  });

  it("102-S1 saves the new date and times with the numbers, then goes back to the event", async () => {
    const fetchMock = mockServer(200, { id: "b-1" });
    render(<VenueBookingChangeForm booking={detail()} equipment={[]} />);
    fireEvent.change(field("Date"), { target: { value: "2030-11-15" } });
    fireEvent.change(field("Start time"), { target: { value: "14:00" } });
    fireEvent.change(field("End time"), { target: { value: "18:00" } });
    fireEvent.change(field("Expected attendance for this venue"), { target: { value: "80" } });

    save();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/events/evt-1"));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4003/venue-bookings/b-1");
    expect(options).toMatchObject({ method: "PATCH", credentials: "include" });
    expect(JSON.parse(options.body)).toEqual({ date: "2030-11-15", startTime: "14:00", endTime: "18:00", expectedAttendance: 80, venueRequirements: "Theatre" });
  });

  it("102-S1 leaves blank attendance and requirements out, so the venue booking keeps its own", async () => {
    const fetchMock = mockServer(200, { id: "b-1" });
    render(<VenueBookingChangeForm booking={detail()} equipment={[]} />);
    fireEvent.change(field("Expected attendance for this venue"), { target: { value: "" } });
    fireEvent.change(field("Venue requirements for this venue"), { target: { value: "  " } });
    fireEvent.change(field("Start time"), { target: { value: "10:00" } });

    save();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ date: "2030-11-14", startTime: "10:00", endTime: "12:00" });
  });

  it.each([
    ["the end before the start", "End time", "08:00", "End time must be after the start time."],
    ["an attendance of 0", "Expected attendance for this venue", "0", "Enter the expected attendance as a whole number of 1 or more."],
  ])("102-S8 %s shows the shared message and sends nothing", (_name, label, value, message) => {
    const fetchMock = mockServer(200, {});
    render(<VenueBookingChangeForm booking={detail()} equipment={[]} />);
    fireEvent.change(field(label), { target: { value } });

    save();

    expect(screen.getByText(message)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("102-S9 shows venue-service's refusal (Nothing was changed.) and stays on the form", async () => {
    mockServer(409, { code: "NO_CHANGES", error: "Nothing was changed." });
    render(<VenueBookingChangeForm booking={detail()} equipment={[]} />);

    save();

    expect((await screen.findByRole("alert")).textContent).toBe("Nothing was changed.");
    expect(push).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Save change" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows venue-service's field errors next to the fields", async () => {
    mockServer(422, { code: "VALIDATION_FAILED", error: "Some fields are invalid.", fieldErrors: { startTime: "The start time must not be in the past." } });
    render(<VenueBookingChangeForm booking={detail()} equipment={[]} />);

    save();

    expect(await screen.findByText("The start time must not be in the past.")).toBeTruthy();
  });

  it("falls back to a general message when the server gives none", async () => {
    mockServer(500, {});
    render(<VenueBookingChangeForm booking={detail()} equipment={[]} />);

    save();

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't save the change. Please try again.");
  });
});

// ----------------------------------------------------------------------------
// SCRUM-102 the change page (/venue-bookings/[id]/change) and the helpers it uses
// ----------------------------------------------------------------------------

describe("SCRUM-102 the change page and helpers", () => {
  const open = async () => render(await ChangeVenueBookingPage({ params: Promise.resolve({ id: "b-1" }) }));

  it("102-S35 shows the form with only this venue booking's equipment that is still needed", async () => {
    getVenueBooking.mockResolvedValue({ booking: detail() });
    getEventEquipmentRequests.mockResolvedValue({
      requests: [projectors, { ...projectors, id: "e-2", equipment: "Cable", venueBookingId: "b-other" }, { ...projectors, id: "e-3", equipment: "Screen", status: "RELEASED" }],
      canCreate: true,
    });

    await open();

    expect(getEventEquipmentRequests).toHaveBeenCalledWith("evt-1");
    expect(screen.getByRole("heading", { name: "Change venue booking" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "← Back to event" }).getAttribute("href")).toBe("/events/evt-1");
    expect(within(screen.getByRole("note")).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["2 × AV: Projector Unit (Arranged)"]);
  });

  it("works when the equipment can't be read", async () => {
    getVenueBooking.mockResolvedValue({ booking: detail() });
    getEventEquipmentRequests.mockResolvedValue(null);

    await open();

    expect(screen.getByRole("heading", { name: "Change venue booking" })).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("102-S11 a rejected venue booking can't be changed: says so instead of the form", async () => {
    getVenueBooking.mockResolvedValue({ booking: detail({ status: "REJECTED" }) });
    getEventEquipmentRequests.mockResolvedValue(null);

    await open();

    expect(screen.getByRole("alert").textContent).toBe("Only a pending or approved venue booking can be changed or cancelled.");
    expect(screen.queryByRole("button", { name: "Save change" })).toBeNull();
  });

  it("shows venue-service's error when the venue booking can't be read", async () => {
    getVenueBooking.mockResolvedValue({ error: "You are not allowed to do that." });
    getEventEquipmentRequests.mockClear();

    await open();

    expect(screen.getByRole("alert").textContent).toBe("You are not allowed to do that.");
    expect(getEventEquipmentRequests).not.toHaveBeenCalled();
  });

  it.each([
    ["PENDING", true],
    ["APPROVED", true],
    ["REJECTED", false],
    ["WITHDRAWN", false],
    ["CANCELLED", false],
  ] as const)("isChangeableVenueBooking(%s) is %s", (status, expected) => {
    expect(isChangeableVenueBooking(status)).toBe(expected);
  });

  it("equipmentFor keeps only this venue booking's equipment that is not released", () => {
    const released = { ...projectors, id: "e-3", status: "RELEASED" as const };
    const other = { ...projectors, id: "e-2", venueBookingId: "b-2" };

    expect(equipmentFor([projectors, released, other], "b-1")).toEqual([projectors]);
  });
});
// end of SCRUM-102
