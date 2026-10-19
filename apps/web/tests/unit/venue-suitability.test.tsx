import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }), redirect: vi.fn() }));

import { SuitabilityCheck } from "@/components/SuitabilityCheck";
import { SuitabilityReport } from "@/components/SuitabilityReport";
import { VenueBookingRequestForm } from "@/components/VenueBookingRequestForm";
import { checkVenueSuitability, suitabilityParams, type SuitabilityView } from "@/lib/venueSuitability";

// SCRUM-109 (docs/specs/venue-suitability.md): the suitability report and the "Check suitability" button.

const notSuitable: SuitabilityView = {
  venue: { id: "ven-2", name: "Lotus Room" },
  event: { id: "evt-1", name: "TechConf 2026" },
  overall: "not_suitable",
  criteria: [
    { key: "capacity", label: "Capacity", status: "not_met", message: "Expected attendance 120 exceeds capacity 60" },
    { key: "layout", label: "Layout", status: "not_met", message: "Theatre not supported" },
    { key: "accessibility", label: "Accessibility", status: "manual", message: "Check manually: Stage must face the windows" },
    { key: "facilities", label: "Facilities", status: "not_checked", message: "Not specified – not checked" },
    { key: "operatingHours", label: "Operating hours", status: "met", message: "Open 08:00–22:00" },
    { key: "availability", label: "Availability", status: "met", message: "Free for the whole period" },
  ],
  manualChecks: ["Stage must face the windows"],
};

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe("SCRUM-109/AC1-AC3 the report shows every requirement with a text status (109-S1, 109-S2, 109-S3)", () => {
  it("109-S3: lists each requirement with its message and a status in words", () => {
    render(<SuitabilityReport report={notSuitable} />);

    expect(screen.getByText("Not suitable")).toBeTruthy();
    expect(screen.getByText("Expected attendance 120 exceeds capacity 60")).toBeTruthy();
    expect(screen.getByText("Theatre not supported")).toBeTruthy();
    expect(screen.getAllByText("Not met")).toHaveLength(2);
    expect(screen.getAllByText("Met")).toHaveLength(2);
    expect(screen.getByText("Not specified – not checked")).toBeTruthy();
  });

  it("109-S1: a suitable venue says Suitable", () => {
    render(<SuitabilityReport report={{ ...notSuitable, overall: "suitable", criteria: [notSuitable.criteria[4]], manualChecks: [] }} />);
    expect(screen.getByText("Suitable")).toBeTruthy();
    expect(screen.queryByText("Check manually")).toBeNull();
  });
});

describe("SCRUM-109/AC6 free text under Check manually (109-S6)", () => {
  it("109-S6: the free-text note is listed under a Check manually heading", () => {
    render(<SuitabilityReport report={notSuitable} />);
    const heading = screen.getByRole("heading", { name: "Check manually" });
    expect(heading).toBeTruthy();
    expect(screen.getAllByText("Stage must face the windows")).toHaveLength(1);
  });
});

describe("SCRUM-109 the Check suitability button on the request form", () => {
  const form = {
    eventId: "evt-1",
    eventName: "TechConf 2026",
    date: "2099-01-01",
    startTime: "09:00",
    endTime: "12:00",
    expectedAttendance: 120,
    venueRequirements: "Theatre",
    accessibilityNeeds: null,
  };
  const venues = [{ id: "ven-2", name: "Lotus Room", max_capacity: 60 }];

  it("asks for a venue first, without calling the service", () => {
    const run = vi.fn();
    render(<SuitabilityCheck eventId="evt-1" venueId="" date="2099-01-01" startTime="09:00" endTime="12:00" run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Check suitability" }));
    expect(screen.getByRole("alert").textContent).toBe("Choose a venue to check.");
    expect(run).not.toHaveBeenCalled();
  });

  it("109-S2: checks the venue, date and times typed in the form and shows the report", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, data: notSuitable });
    render(<SuitabilityCheck eventId="evt-1" venueId="ven-2" date="2099-01-01" startTime="07:00" endTime="12:00" run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Check suitability" }));

    await waitFor(() => expect(screen.getByText("Not suitable")).toBeTruthy());
    expect(run).toHaveBeenCalledWith({ venueId: "ven-2", eventId: "evt-1", date: "2099-01-01", startTime: "07:00", endTime: "12:00" });
  });

  it("shows the service's message when the check fails", async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, data: { error: "You are not allowed to do that." } });
    render(<SuitabilityCheck eventId="evt-1" venueId="ven-2" date="2099-01-01" startTime="09:00" endTime="12:00" run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Check suitability" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("You are not allowed to do that."));
  });

  it("shows the first field error from a 422", async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, data: { error: "Some fields are invalid.", fieldErrors: { startTime: "Enter the start time as HH:MM." } } });
    render(<SuitabilityCheck eventId="evt-1" venueId="ven-2" date="2099-01-01" startTime="" endTime="12:00" run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "Check suitability" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Enter the start time as HH:MM."));
  });

  it("is on the venue request form and calls venue-service with what is typed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => notSuitable });
    vi.stubGlobal("fetch", fetchMock);
    render(<VenueBookingRequestForm form={form} venues={venues} />);

    fireEvent.change(screen.getByLabelText("Venue"), { target: { value: "ven-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Check suitability" }));

    await waitFor(() => expect(screen.getByText("Theatre not supported")).toBeTruthy());
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/venue-suitability");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      venueId: "ven-2",
      eventId: "evt-1",
      date: "2099-01-01",
      startTime: "09:00",
      endTime: "12:00",
    });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
    // Information only: the request was not submitted.
    expect(push).not.toHaveBeenCalled();
  });
});

describe("SCRUM-109 the browser call", () => {
  it("leaves out blank fields and sends skipAvailability and attendance when given", () => {
    const params = suitabilityParams({ venueId: "v", eventId: "e", date: "", attendance: 40, skipAvailability: true });
    expect(Object.fromEntries(params)).toEqual({ venueId: "v", eventId: "e", attendance: "40", skipAvailability: "true" });
  });

  it("reports a network failure in words", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    const { ok, data } = await checkVenueSuitability({ venueId: "v", eventId: "e" });
    expect(ok).toBe(false);
    expect(data.error).toMatch(/couldn't reach the server/);
  });

  it("returns the report on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => notSuitable }));
    const { ok, data } = await checkVenueSuitability({ venueId: "v", eventId: "e" });
    expect(ok).toBe(true);
    expect(data.overall).toBe("not_suitable");
  });
});
