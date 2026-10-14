import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), redirect: vi.fn() }));

import { EventStatusPanel } from "@/components/EventStatusPanel";
import { VenueBookingRequestForm } from "@/components/VenueBookingRequestForm";

const NOT_ELIGIBLE = "The event must be approved before a venue can be requested.";

const panelEvent = (status: string, canChangeStatus = true) => ({ id: "evt-1", name: "Tech Summit", status, canChangeStatus, canReview: false });

const form = {
  eventId: "evt-1",
  eventName: "Tech Summit",
  date: "2099-01-01",
  startTime: "09:00",
  endTime: "12:00",
  expectedAttendance: 120,
  venueRequirements: "Projector",
  accessibilityNeeds: "Step-free access",
};
const venues = [{ id: "ven-1", name: "Grand Hall", max_capacity: 200 }];

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe("SCRUM-32/AC3 event page venue request link (32-S2, 32-S3)", () => {
  it("32-S2: the assigned coordinator sees a Request a venue link on an approved event", () => {
    render(<EventStatusPanel event={panelEvent("approved")} />);

    expect(screen.getByRole("link", { name: "Request a venue" }).getAttribute("href")).toBe("/events/evt-1/venue-request");
    expect(screen.queryByText(NOT_ELIGIBLE)).toBeNull();
  });

  it("32-S3: an event that isn't approved yet shows the not-eligible message and no link", () => {
    render(<EventStatusPanel event={panelEvent("under_review")} />);

    expect(screen.getByText(NOT_ELIGIBLE)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Request a venue" })).toBeNull();
  });

  it("offers nothing to a viewer who isn't the assigned coordinator", () => {
    render(<EventStatusPanel event={panelEvent("approved", false)} />);

    expect(screen.queryByRole("link", { name: "Request a venue" })).toBeNull();
    expect(screen.queryByText(NOT_ELIGIBLE)).toBeNull();
  });
});

describe("SCRUM-32/AC2 venue booking request form (32-S1, 32-S2, 32-S5)", () => {
  it("32-S1: shows the event's attendance, requirements and accessibility read-only, with the slot pre-filled", () => {
    render(<VenueBookingRequestForm form={form} venues={venues} />);

    expect(screen.getByText("120")).toBeTruthy();
    expect(screen.getByText("Projector")).toBeTruthy();
    expect(screen.getByText("Step-free access")).toBeTruthy();
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2099-01-01");
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("09:00");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("12:00");
  });

  it("32-S5: shows the shared validation errors and doesn't call venue-service", () => {
    const fetchMock = mockServer(201, { id: "b-1" });
    render(<VenueBookingRequestForm form={{ ...form, date: null, startTime: null, endTime: null }} venues={venues} />);

    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(screen.getByText("Choose a venue.")).toBeTruthy();
    expect(screen.getByText("Enter the date as YYYY-MM-DD.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("32-S2: submits the request and goes to its detail page", async () => {
    const fetchMock = mockServer(201, { id: "b-1" });
    render(<VenueBookingRequestForm form={form} venues={venues} />);

    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "ven-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/venue-bookings/b-1"));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4003/venue-bookings");
    expect(JSON.parse(options.body)).toEqual({
      eventId: "evt-1", venueId: "ven-1", date: "2099-01-01", startTime: "09:00", endTime: "12:00",
    });
  });

  it("shows venue-service's message and field errors when it refuses", async () => {
    mockServer(409, { code: "SLOT_CONFLICT", error: "This venue is already held for part of that period." });
    render(<VenueBookingRequestForm form={form} venues={venues} />);

    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "ven-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This venue is already held for part of that period.");
    expect(push).not.toHaveBeenCalled();

    mockServer(422, { code: "VALIDATION_FAILED", error: "Check the form.", fieldErrors: { endTime: "End time must be after the start time." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(await screen.findByText("End time must be after the start time.")).toBeTruthy();
  });
});

// ----------------------------------------------------------------------------
// SCRUM-98/AC2 each venue booking can have its own expected attendance and venue requirements, and is warned about capacity
// (the event expects 120 people; Grand Hall holds 200, Lotus Room 100)
// ----------------------------------------------------------------------------

describe("SCRUM-98/AC2 the venue booking's own attendance and requirements (98-S6, 98-S7, 98-S12)", () => {
  const twoVenues = [...venues, { id: "ven-2", name: "Lotus Room", max_capacity: 100 }];
  const ownAttendance = () => screen.getByLabelText("Expected attendance for this venue") as HTMLInputElement;
  const ownRequirements = () => screen.getByLabelText("Venue requirements for this venue") as HTMLInputElement;

  it("98-S7 the two fields start empty and say the event's own values are used if left blank", () => {
    render(<VenueBookingRequestForm form={form} venues={venues} />);

    expect(ownAttendance().value).toBe("");
    expect(ownRequirements().value).toBe("");
    expect(screen.getByText("Leave blank to use the event's: 120")).toBeTruthy();
    expect(screen.getByText("Leave blank to use the event's: Projector")).toBeTruthy();
  });

  it("98-S6 sends this venue booking's own attendance (as a number) and requirements", async () => {
    const fetchMock = mockServer(201, { id: "b-1" });
    render(<VenueBookingRequestForm form={form} venues={twoVenues} />);

    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "ven-2" } });
    fireEvent.change(ownAttendance(), { target: { value: "80" } });
    fireEvent.change(ownRequirements(), { target: { value: "Breakout tables" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/venue-bookings/b-1"));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      eventId: "evt-1", venueId: "ven-2", date: "2099-01-01", startTime: "09:00", endTime: "12:00",
      expectedAttendance: 80, venueRequirements: "Breakout tables",
    });
  });

  it.each(["0", "-5", "2.5"])("98-S12 an attendance of %s shows the shared error and is not sent", (typed) => {
    const fetchMock = mockServer(201, { id: "b-1" });
    render(<VenueBookingRequestForm form={form} venues={venues} />);

    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "ven-1" } });
    fireEvent.change(ownAttendance(), { target: { value: typed } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    expect(screen.getByText("Enter the expected attendance as a whole number of 1 or more.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-98/AC2 the capacity warning on the form (98-S10, 98-S11)", () => {
  const twoVenues = [...venues, { id: "ven-2", name: "Lotus Room", max_capacity: 100 }];
  const WARNING = /Lotus Room holds 100 people, but 120 are expected/;

  it("98-S10 warns when the chosen venue holds fewer people than the event expects", () => {
    render(<VenueBookingRequestForm form={form} venues={twoVenues} />);

    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "ven-2" } });

    expect(screen.getByText(WARNING)).toBeTruthy();
    expect(screen.getByText(WARNING).textContent).toContain("You can still submit");
  });

  it("98-S10 uses this venue booking's own attendance when one is typed", () => {
    render(<VenueBookingRequestForm form={form} venues={twoVenues} />);
    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "ven-2" } });

    fireEvent.change(screen.getByLabelText("Expected attendance for this venue"), { target: { value: "80" } });
    expect(screen.queryByText(/holds 100 people/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Expected attendance for this venue"), { target: { value: "150" } });
    expect(screen.getByText(/Lotus Room holds 100 people, but 150 are expected/)).toBeTruthy();
  });

  it("98-S11 no warning when the venue is big enough, or before a venue is chosen", () => {
    render(<VenueBookingRequestForm form={form} venues={twoVenues} />);
    expect(screen.queryByText(/holds/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "ven-1" } }); // Grand Hall holds 200

    expect(screen.queryByText(/holds/)).toBeNull();
  });

  it("98-S10 the warning does not stop the venue booking being submitted", async () => {
    mockServer(201, { id: "b-9", exceedsCapacity: true });
    render(<VenueBookingRequestForm form={form} venues={twoVenues} />);

    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "ven-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/venue-bookings/b-9"));
  });
});
// end of SCRUM-98
