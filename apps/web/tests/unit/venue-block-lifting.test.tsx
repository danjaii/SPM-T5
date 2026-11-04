import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnavailabilityBlockView } from "@spm-t5/shared";

const { refresh, toastSuccess } = vi.hoisted(() => ({ refresh: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), redirect: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

import { VenueDetail, type VenueDetails } from "@/components/VenueDetail";
import { liftVenueUnavailability } from "@/lib/venueUnavailability";

// SCRUM-185/AC2 (docs/specs/venue-block-lifting.md): Venue Staff lift a block from the venue page, after a confirmation.
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
  can_mark_unavailable: true, unavailability: [block()],
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
  toastSuccess.mockClear();
});

describe("SCRUM-185/AC2 185-S2 the Lift block button", () => {
  it("185-S2: Venue Staff see one Lift block button for each block", () => {
    render(<VenueDetail venue={venue({ unavailability: [block(), block({ id: "b2", startDate: "2026-12-01" })] })} />);

    expect(screen.getAllByRole("button", { name: /^Lift block/ })).toHaveLength(2);
  });

  it("185-S2c: every other role sees none", () => {
    render(<VenueDetail venue={venue({ can_mark_unavailable: false })} />);

    expect(screen.queryByRole("button", { name: /^Lift block/ })).toBeNull();
    expect(screen.getByText("14 Nov 08:00 to 16 Nov 18:00, Maintenance")).toBeTruthy();
  });

  it("185-S2: the button names the period it lifts, for a screen reader", () => {
    render(<VenueDetail venue={venue()} />);

    expect(screen.getByRole("button", { name: "Lift block 14 Nov 08:00 to 16 Nov 18:00" })).toBeTruthy();
  });
});

describe("SCRUM-185/AC2 185-S2 lifting asks first, then calls venue-service", () => {
  it("185-S2: nothing is sent until the confirmation is accepted", () => {
    const fetchMock = mockServer(200, { lifted: true, notifiedCoordinators: 0, message: "x" });
    render(<VenueDetail venue={venue()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Lift block/ }));

    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Coordinators with affected bookings will be told.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("185-S2: Keep block closes the dialog and sends nothing", () => {
    const fetchMock = mockServer(200, {});
    render(<VenueDetail venue={venue()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Lift block/ }));
    fireEvent.click(screen.getByRole("button", { name: "Keep block" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("185-S2: Yes, lift block posts to the lift endpoint, says how many were told, and refreshes the page", async () => {
    const fetchMock = mockServer(200, { lifted: true, notifiedCoordinators: 2, message: "Unavailable period lifted. 2 coordinators have been notified." });
    render(<VenueDetail venue={venue()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Lift block/ }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, lift block" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/venues\/orchid\/unavailability\/b1\/lift$/);
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(toastSuccess).toHaveBeenCalledWith("Unavailable period lifted. 2 coordinators have been notified.");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("185-S2d: a refusal is shown in the dialog, which stays open, and nothing refreshes", async () => {
    mockServer(404, { code: "NOT_FOUND", error: "Unavailable period not found." });
    render(<VenueDetail venue={venue()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Lift block/ }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, lift block" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Unavailable period not found.");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("185-S2: a success answer without a message still confirms with a plain one", async () => {
    mockServer(200, { lifted: true, notifiedCoordinators: 0 });
    render(<VenueDetail venue={venue()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Lift block/ }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, lift block" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Unavailable period lifted."));
  });

  it("185-S2d: a failure answer without a reason shows a plain retry message", async () => {
    mockServer(500, {});
    render(<VenueDetail venue={venue()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Lift block/ }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, lift block" }));

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't lift the unavailable period. Please try again.");
  });

  it("185-S2: an unreachable server says so", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<VenueDetail venue={venue()} />);

    fireEvent.click(screen.getByRole("button", { name: /^Lift block/ }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, lift block" }));

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn't reach the server. Please try again.");
  });
});

describe("SCRUM-185/AC2 185-S2 liftVenueUnavailability", () => {
  it("185-S2: encodes both ids in the path and returns the JSON as is", async () => {
    const fetchMock = mockServer(200, { lifted: true, notifiedCoordinators: 0, message: "m" });

    const result = await liftVenueUnavailability("a b", "c/d");

    expect(result).toEqual({ ok: true, data: { lifted: true, notifiedCoordinators: 0, message: "m" } });
    expect((fetchMock.mock.calls[0] as [string])[0]).toMatch(/\/venues\/a%20b\/unavailability\/c%2Fd\/lift$/);
  });
});
