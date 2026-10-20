import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sgtToUtc } from "@spm-t5/shared";

const { getEvent, getChangeRequests, getEventOutcome, refresh } = vi.hoisted(() => ({
  getEvent: vi.fn(),
  getChangeRequests: vi.fn(),
  getEventOutcome: vi.fn().mockResolvedValue(null),
  refresh: vi.fn(),
}));
const { getEventVenueBookings } = vi.hoisted(() => ({ getEventVenueBookings: vi.fn() }));
vi.mock("@/lib/getEvent", () => ({
  getEvent,
  getChangeRequests,
  getEventOutcome,
  getEventChangeHistory: async () => null,
  getEventSafetyDecisions: async () => null, // SCRUM-100/AC7
}));
vi.mock("@/lib/venueBookingsServer", () => ({ getEventVenueBookings }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn(), refresh }) }));

import EventPage from "@/app/events/[id]/page";
import { EventChangeRequestForm } from "@/components/EventChangeRequestForm";
import { EventChangeRequestList } from "@/components/EventChangeRequestList";

const event = {
  id: "evt-1",
  name: "Tech Summit",
  status: "submitted",
  canChangeStatus: false,
  canReview: false,
  point_of_contact_name: null,
  isOrganiser: true,
  canRequestChange: true,
  purpose: null,
  preferred_start_datetime: sgtToUtc("2031-11-14", "09:00").toISOString(),
  preferred_end_datetime: sgtToUtc("2031-11-14", "17:00").toISOString(),
  expected_attendance: 100,
  preferred_layout_name: null,
  accessibility_requirements: null,
  equipment_requirements_notes: "Two projectors",
  submitted_at: "2026-10-01T02:00:00Z",
  organiser_name: "Sam Tan",
};

/** Pretends event-service answered the browser's request with this status code and JSON body. */
function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Submit change request" }));

beforeEach(() => {
  refresh.mockReset();
  getEventVenueBookings.mockReset().mockResolvedValue(null);
  getChangeRequests.mockReset().mockResolvedValue([]);
});
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-66/AC1, AC2, AC3 the event page offers a change request only when allowed", () => {
  const open = async () => render(await EventPage({ params: Promise.resolve({ id: "evt-1" }), searchParams: Promise.resolve({ tab: "changes" }) }));

  it("AC1 shows the form to the organiser of a submitted event", async () => {
    getEvent.mockResolvedValue({ event });
    await open();
    expect(screen.getByRole("heading", { name: "Request a change" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit change request" })).toBeTruthy();
  });

  it.each(["draft", "cancelled", "rejected", "completed"])("AC2, AC3 hides the form for a %s event", async (status) => {
    getEvent.mockResolvedValue({ event: { ...event, status, canRequestChange: false } });
    await open();
    expect(screen.queryByRole("button", { name: "Submit change request" })).toBeNull();
  });

  it("hides the form and the list from someone who is not the organiser", async () => {
    getEvent.mockResolvedValue({ event: { ...event, isOrganiser: false, canRequestChange: false } });
    await open();
    expect(screen.queryByRole("heading", { name: "Request a change" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Change requests" })).toBeNull();
    expect(getChangeRequests).not.toHaveBeenCalled();
  });
});

describe("SCRUM-66/AC7 the organiser sees whether each request is pending, approved or rejected", () => {
  it("shows each request with its status", () => {
    render(
      <EventChangeRequestList
        requests={[
          { id: "1", change_description: "More sign-ups", proposed_changes: null, status: "pending", requested_at: "2031-01-02T00:00:00Z" },
          { id: "2", change_description: "Older", proposed_changes: null, status: "approved", requested_at: "2031-01-01T00:00:00Z" },
          { id: "3", change_description: "Oldest", proposed_changes: null, status: "rejected", requested_at: "2030-12-01T00:00:00Z", review_notes: "Venue is full" },
        ]}
      />,
    );
    expect(screen.getByText("Pending", { selector: "[data-tone]" })).toBeTruthy();
    expect(screen.getByText("Approved", { selector: "[data-tone]" })).toBeTruthy();
    expect(screen.getByText("Rejected", { selector: "[data-tone]" })).toBeTruthy();
    expect(screen.getByText("Venue is full")).toBeTruthy();
  });

  // The log shows when the request was made, to the minute, in Singapore time whatever the server's time zone
  it("shows the date and time each request was made, in Singapore time", () => {
    render(
      <EventChangeRequestList
        requests={[
          // 00:00 UTC is 8:00 am in Singapore; 16:30 UTC on the 1st is 12:30 am on the 2nd there
          { id: "1", change_description: "Morning", proposed_changes: null, status: "pending", requested_at: "2031-01-02T00:00:00Z" },
          { id: "2", change_description: "After midnight", proposed_changes: null, status: "pending", requested_at: "2031-01-01T16:30:00Z" },
        ]}
      />,
    );
    const text = (description: string) => screen.getByText(description).closest("li")!.textContent ?? "";
    expect(text("Morning")).toMatch(/\(2 Jan 2031,\s*8:00\s*am\)/i);
    expect(text("After midnight")).toMatch(/\(2 Jan 2031,\s*12:30\s*am\)/i);
  });

  it("says so when there are none", () => {
    render(<EventChangeRequestList requests={[]} />);
    expect(screen.getByText("No change requests yet.")).toBeTruthy();
  });

  it("the event page loads the requests for the organiser", async () => {
    getEvent.mockResolvedValue({ event });
    getChangeRequests.mockResolvedValue([
      { id: "1", change_description: "More sign-ups", proposed_changes: null, status: "pending", requested_at: "2031-01-02T00:00:00Z" },
    ]);
    render(await EventPage({ params: Promise.resolve({ id: "evt-1" }), searchParams: Promise.resolve({ tab: "changes" }) }));
    expect(getChangeRequests).toHaveBeenCalledWith("evt-1");
    expect(screen.getByText("Pending", { selector: "[data-tone]" })).toBeTruthy();
  });
});

describe("SCRUM-66/AC8 the form starts from the event's current details", () => {
  it("is pre-filled and offers every editable field", () => {
    render(<EventChangeRequestForm event={event} />);
    expect((screen.getByLabelText("Expected attendance") as HTMLInputElement).value).toBe("100");
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2031-11-14");
    expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("09:00");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe("17:00");
    expect((screen.getByLabelText("Equipment requirements") as HTMLTextAreaElement).value).toBe("Two projectors");
    expect(screen.getByLabelText("Venue requirements")).toBeTruthy();
  });
});

describe("SCRUM-66/AC4 no detail changed", () => {
  it("does not submit and says no changes were made", () => {
    const fetchMock = mockServer(201, {});
    render(<EventChangeRequestForm event={event} />);
    submit();
    expect(screen.getByRole("alert").textContent).toMatch(/no changes were made/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-66/AC5 expected attendance must be a positive whole number", () => {
  it.each(["0", "-4", "2.5", "many", ""])("refuses %j without submitting", (value) => {
    const fetchMock = mockServer(201, {});
    render(<EventChangeRequestForm event={event} />);
    type("Expected attendance", value);
    submit();
    expect(screen.getByText(/positive whole number/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-66/AC9 and AC10 date and time rules", () => {
  it("AC9 refuses a past date", () => {
    const fetchMock = mockServer(201, {});
    render(<EventChangeRequestForm event={event} />);
    type("Date", "2020-01-01");
    submit();
    expect(screen.getByText(/must not be in the past/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AC10 refuses an end time before the start time", () => {
    const fetchMock = mockServer(201, {});
    render(<EventChangeRequestForm event={event} />);
    type("Start time", "15:00");
    type("End time", "10:00");
    submit();
    expect(screen.getByText(/End time must be after the start time/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-66/AC10 the end date is visible and editable", () => {
  const multiDay = {
    ...event,
    preferred_start_datetime: sgtToUtc("2031-11-14", "09:00").toISOString(),
    preferred_end_datetime: sgtToUtc("2031-11-15", "17:00").toISOString(),
  };

  it("shows a single-day event's end date as its date", () => {
    render(<EventChangeRequestForm event={event} />);
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2031-11-14");
  });

  it("shows a multi-day event's own end date", () => {
    render(<EventChangeRequestForm event={multiDay} />);
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2031-11-15");
  });

  it("moves a single-day event's end date with its date", () => {
    render(<EventChangeRequestForm event={event} />);
    type("Date", "2031-12-01");
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2031-12-01");
  });

  it("keeps a multi-day event's end date when the date changes", () => {
    render(<EventChangeRequestForm event={multiDay} />);
    type("Date", "2031-11-13");
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2031-11-15");
  });

  it("refuses an end date before the date, naming the End date field", () => {
    const fetchMock = mockServer(201, {});
    render(<EventChangeRequestForm event={multiDay} />);
    type("End date", "2031-11-13");
    submit();
    expect(screen.getByText(/End date must not be before the date/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an earlier clock time on a later end date, because the end is still after the start", async () => {
    const fetchMock = mockServer(201, { message: "ok" });
    render(<EventChangeRequestForm event={multiDay} />);
    type("End time", "08:00");
    submit();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ endDate: "2031-11-15", endTime: "08:00" });
  });

  it("still refuses an end time at or before the start when the end date is the same day", () => {
    const fetchMock = mockServer(201, {});
    render(<EventChangeRequestForm event={multiDay} />);
    type("End date", "2031-11-14");
    type("End time", "08:00");
    submit();
    expect(screen.getByText(/End time must be after the start time/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-66/AC6 a valid request is submitted and confirmed", () => {
  it("posts the change, confirms it and refreshes the page", async () => {
    const fetchMock = mockServer(201, { message: "Your change request was submitted for approval." });
    render(<EventChangeRequestForm event={event} />);
    type("Expected attendance", "150");
    type("Reason for the change (optional)", "More sign-ups");
    submit();

    expect(await screen.findByText(/submitted for approval/)).toBeTruthy();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4002/events/evt-1/change-requests");
    expect(options).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(options.body)).toMatchObject({ expectedAttendance: "150", reason: "More sign-ups" });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("shows event-service's message when it refuses", async () => {
    mockServer(409, { error: "A change request can't be made for an event that is a draft." });
    render(<EventChangeRequestForm event={event} />);
    type("Expected attendance", "150");
    submit();
    expect((await screen.findByRole("alert")).textContent).toMatch(/can't be made/);
    expect(refresh).not.toHaveBeenCalled();
  });
});
