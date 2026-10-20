import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnavailabilityBlockView } from "@spm-t5/shared";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), redirect: vi.fn() }));

import { VenueAvailabilityDay } from "@/components/VenueAvailabilityDay";
import { VenueDetail, type VenueDetails } from "@/components/VenueDetail";
import { postVenueUnavailability } from "@/lib/venueUnavailability";
import type { VenueAvailabilityData } from "@/lib/venueAvailability";

// SCRUM-105 (docs/specs/venue-unavailability.md): the unavailable periods on the venue page, the staff-only form, the day view.
const block = (extra: Partial<UnavailabilityBlockView> = {}): UnavailabilityBlockView => ({
  id: "b1",
  start: "2026-11-14T00:00:00.000Z",
  end: "2026-11-16T10:00:00.000Z",
  startDate: "2026-11-14",
  startTime: "08:00",
  endDate: "2026-11-16",
  endTime: "18:00",
  reason: "maintenance",
  reasonLabel: "Maintenance",
  recordedAt: "2026-11-01T02:30:00.000Z",
  ...extra,
});

const venue = (extra: Partial<VenueDetails> = {}): VenueDetails => ({
  id: "orchid", name: "Orchid Hall", address: "Level 3", description: null, max_capacity: 150,
  operating_hours_start: null, operating_hours_end: null, is_accessible: true, accessibility_notes: null,
  layouts: [], facilities: [], setup_minutes: 0, turnaround_minutes: 0, can_edit_timing: false,
  can_mark_unavailable: false, unavailability: [],
  ...extra,
});

function mockServer(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
});

function fill(values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
const FILLED = { "Start date": "2026-11-14", "Start time": "08:00", "End date": "2026-11-16", "End time": "18:00", Reason: "maintenance" };

describe("SCRUM-105/AC1 the detail view lists the unavailable periods (105-S1)", () => {
  it("105-S1: shows 14 Nov 08:00 to 16 Nov 18:00 with the reason", () => {
    render(<VenueDetail venue={venue({ unavailability: [block()] })} />);

    expect(screen.getByRole("heading", { name: "Unavailable periods" })).toBeTruthy();
    expect(screen.getByText("14 Nov 08:00 to 16 Nov 18:00, Maintenance")).toBeTruthy();
  });

  it("105-S1: venue staff also see the notes and who recorded it", () => {
    render(<VenueDetail venue={venue({ can_mark_unavailable: true, unavailability: [block({ reason: "safety", reasonLabel: "Safety concern", notes: "Fire door repair", recordedBy: "Kenneth Wong" })] })} />);

    expect(screen.getByText("14 Nov 08:00 to 16 Nov 18:00, Safety concern")).toBeTruthy();
    expect(screen.getByText(/Fire door repair/)).toBeTruthy();
    expect(screen.getByText(/Recorded by Kenneth Wong/)).toBeTruthy();
  });

  it("105-S1: a venue with none says so", () => {
    render(<VenueDetail venue={venue()} />);
    expect(screen.getByText("No upcoming unavailable periods.")).toBeTruthy();
  });

  it("105-S1: a response from an older service (no unavailability field) still renders", () => {
    const old = venue();
    delete old.unavailability;
    delete old.can_mark_unavailable;
    render(<VenueDetail venue={old} />);
    expect(screen.getByText("No upcoming unavailable periods.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark unavailable" })).toBeNull();
  });
});

describe("SCRUM-105/AC6 only venue staff see the form (105-S6)", () => {
  it("105-S6: a coordinator sees the periods and no form or button", () => {
    render(<VenueDetail venue={venue({ unavailability: [block()] })} />);

    expect(screen.getByText("14 Nov 08:00 to 16 Nov 18:00, Maintenance")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark unavailable" })).toBeNull();
    expect(screen.queryByLabelText("Reason")).toBeNull();
  });

  it("105-S6: venue staff get the form", () => {
    render(<VenueDetail venue={venue({ can_mark_unavailable: true })} />);
    expect(screen.getByRole("button", { name: "Mark unavailable" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark unavailable" }));
    for (const label of ["Start date", "Start time", "End date", "End time", "Reason", "Notes"]) expect(screen.getByLabelText(label)).toBeTruthy();
  });
});

describe("SCRUM-105/AC2 a reason is required (105-S2)", () => {
  it("105-S2: offers the five reasons, with 'Safety concern' for safety, and not Internal activity", () => {
    render(<VenueDetail venue={venue({ can_mark_unavailable: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark unavailable" }));

    const options = within(screen.getByLabelText("Reason")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Choose a reason", "Maintenance", "Equipment failure", "Renovation", "Safety concern", "Other"]);
  });

  it("105-S2: submitting without a reason shows a message and sends nothing", () => {
    const fetchMock = mockServer(201, {});
    render(<VenueDetail venue={venue({ can_mark_unavailable: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark unavailable" }));

    fill({ ...FILLED, Reason: "" });
    fireEvent.click(screen.getByRole("button", { name: "Save unavailable period" }));

    expect(screen.getByText("Choose a reason.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("105-S2: Other without notes shows a message [PROPOSED]", () => {
    const fetchMock = mockServer(201, {});
    render(<VenueDetail venue={venue({ can_mark_unavailable: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark unavailable" }));

    fill({ ...FILLED, Reason: "other" });
    fireEvent.click(screen.getByRole("button", { name: "Save unavailable period" }));

    expect(screen.getByText("Enter notes describing the reason.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SCRUM-105/AC3 the end must follow the start (105-S3)", () => {
  it.each([
    ["equal to the start", { "End date": "2026-11-14", "End time": "08:00" }],
    ["before the start", { "End date": "2026-11-13", "End time": "18:00" }],
  ])("105-S3: an end %s shows a message and sends nothing", (_name, change) => {
    const fetchMock = mockServer(201, {});
    render(<VenueDetail venue={venue({ can_mark_unavailable: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark unavailable" }));

    fill({ ...FILLED, ...change });
    fireEvent.click(screen.getByRole("button", { name: "Save unavailable period" }));

    expect(screen.getByText("The end must be after the start.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("SCRUM-105/AC1 saving a block (105-S1)", () => {
  it("105-S1: POSTs the period in Singapore time with the reason, says it was saved and refreshes the page", async () => {
    const fetchMock = mockServer(201, { block: block() });
    render(<VenueDetail venue={venue({ can_mark_unavailable: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark unavailable" }));

    fill({ ...FILLED, Notes: "Annual inspection" });
    fireEvent.click(screen.getByRole("button", { name: "Save unavailable period" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/venues\/orchid\/unavailability$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body)).toEqual({ startDate: "2026-11-14", startTime: "08:00", endDate: "2026-11-16", endTime: "18:00", reason: "maintenance", notes: "Annual inspection" });
    expect(screen.getByRole("status").textContent).toContain("14 Nov 08:00 to 16 Nov 18:00");
  });

  it("105-S1: a server refusal per field is shown and the page is not refreshed", async () => {
    mockServer(422, { code: "VALIDATION_FAILED", error: "Some fields are invalid.", fieldErrors: { reason: "Choose one of the listed reasons." } });
    render(<VenueDetail venue={venue({ can_mark_unavailable: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark unavailable" }));

    fill(FILLED);
    fireEvent.click(screen.getByRole("button", { name: "Save unavailable period" }));

    expect(await screen.findByText("Choose one of the listed reasons.")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("105-S6: a 403 message from the server is shown", async () => {
    mockServer(403, { code: "FORBIDDEN", error: "Only venue staff can mark a venue unavailable." });
    render(<VenueDetail venue={venue({ can_mark_unavailable: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark unavailable" }));

    fill(FILLED);
    fireEvent.click(screen.getByRole("button", { name: "Save unavailable period" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Only venue staff");
  });

  it("105-S1: postVenueUnavailability reports an unreachable server instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await postVenueUnavailability("orchid", { startDate: "a", startTime: "b", endDate: "c", endTime: "d", reason: "maintenance" });
    expect(result.ok).toBe(false);
    expect(result.data.error).toMatch(/couldn't reach the server/);
  });
});

describe("SCRUM-105/AC4 the day view shows an Unavailable segment (105-S4)", () => {
  const day = (extra: Partial<VenueAvailabilityData> = {}): VenueAvailabilityData => ({
    venue: { id: "orchid", name: "Orchid Hall" }, date: "2026-11-15", setup_minutes: 30, turnaround_minutes: 0, periods: [], unavailable: [block()], ...extra,
  });

  it("105-S4: names the block in text, with its period and reason, next to nothing else", () => {
    render(<VenueAvailabilityDay data={day()} />);

    expect(screen.getByText("Unavailable 2026-11-14 08:00 to 2026-11-16 18:00 (Maintenance)")).toBeTruthy();
    expect(screen.queryByText(/free all day/)).toBeNull();
  });

  it("105-S4: a block that starts on the day shows only the clock times", () => {
    render(<VenueAvailabilityDay data={day({ date: "2026-11-14", unavailable: [block({ start: "2026-11-14T00:00:00.000Z", end: "2026-11-14T09:00:00.000Z" })] })} />);
    expect(screen.getByText("Unavailable 08:00 to 17:00 (Maintenance)")).toBeTruthy();
  });

  it("105-S4: a day with neither bookings nor blocks is free, and an older response without the field still renders", () => {
    render(<VenueAvailabilityDay data={day({ unavailable: [] })} />);
    expect(screen.getByText(/free all day/)).toBeTruthy();
    const old = day();
    delete old.unavailable;
    render(<VenueAvailabilityDay data={old} />);
    expect(screen.getAllByText(/free all day/).length).toBeGreaterThan(0);
  });
});
