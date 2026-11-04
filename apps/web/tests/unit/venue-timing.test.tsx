import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), redirect: vi.fn() }));

import { VenueDetail, type VenueDetails } from "@/components/VenueDetail";
import { putVenueTiming } from "@/lib/venueTiming";

const venue = (extra: Partial<VenueDetails> = {}): VenueDetails => ({
  id: "orchid", name: "Orchid Hall", address: "Level 3", description: null, max_capacity: 150,
  operating_hours_start: null, operating_hours_end: null, is_accessible: true, accessibility_notes: null,
  layouts: [], facilities: [], setup_minutes: 0, turnaround_minutes: 0, can_edit_timing: false,
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

describe("SCRUM-101/AC2 the detail view shows the times (101-S2)", () => {
  it("101-S2: a venue never given times shows 0 minutes for both", () => {
    render(<VenueDetail venue={venue()} />);
    expect(screen.getByText("Setup time").nextElementSibling?.textContent).toBe("0 minutes");
    expect(screen.getByText("Turnaround time").nextElementSibling?.textContent).toBe("0 minutes");
  });

  it("101-S1: shows the saved times", () => {
    render(<VenueDetail venue={venue({ setup_minutes: 30, turnaround_minutes: 45 })} />);
    expect(screen.getByText("30 minutes")).toBeTruthy();
    expect(screen.getByText("45 minutes")).toBeTruthy();
  });

  it("101-S2: one minute is singular", () => {
    render(<VenueDetail venue={venue({ setup_minutes: 1 })} />);
    expect(screen.getByText("1 minute")).toBeTruthy();
  });
});

describe("SCRUM-101/AC4 only Venue Staff see the form (101-S4)", () => {
  it("101-S4: a coordinator sees the times and no form", () => {
    render(<VenueDetail venue={venue({ setup_minutes: 30, turnaround_minutes: 45, can_edit_timing: false })} />);
    expect(screen.getByText("30 minutes")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save times" })).toBeNull();
    expect(screen.queryByLabelText("Setup time (minutes)")).toBeNull();
  });

  it("101-S4: venue staff get the form filled with the current times", () => {
    render(<VenueDetail venue={venue({ setup_minutes: 30, turnaround_minutes: 45, can_edit_timing: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit times" }));
    expect((screen.getByLabelText("Setup time (minutes)") as HTMLInputElement).value).toBe("30");
    expect((screen.getByLabelText("Turnaround time (minutes)") as HTMLInputElement).value).toBe("45");
    expect(screen.getByRole("button", { name: "Save times" })).toBeTruthy();
  });
});

describe("SCRUM-101/AC1 saving the times (101-S1)", () => {
  it("101-S1: PUTs both values, says saved and refreshes the page", async () => {
    const fetchMock = mockServer(200, { setup_minutes: 30, turnaround_minutes: 45 });
    render(<VenueDetail venue={venue({ can_edit_timing: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit times" }));

    fireEvent.change(screen.getByLabelText("Setup time (minutes)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Turnaround time (minutes)"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save times" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/venues\/orchid\/timing$/);
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body)).toEqual({ setupMinutes: 30, turnaroundMinutes: 45 });
    expect(screen.getByRole("status").textContent).toContain("saved");
  });
});

describe("SCRUM-101/AC3 invalid values are rejected and the old ones kept (101-S3)", () => {
  it.each(["-15", "12.5", "abc", ""])("101-S3: %j shows a message and sends nothing", (value) => {
    const fetchMock = mockServer(200, {});
    render(<VenueDetail venue={venue({ setup_minutes: 30, turnaround_minutes: 45, can_edit_timing: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit times" }));

    fireEvent.change(screen.getByLabelText("Setup time (minutes)"), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save times" }));

    expect(screen.getByText(/Setup time must be a whole number of minutes/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // the shown (saved) values stay on the page
    expect(screen.getByText("30 minutes")).toBeTruthy();
    expect(screen.getByText("45 minutes")).toBeTruthy();
  });

  it("101-S3: a server refusal is shown and the page is not refreshed", async () => {
    mockServer(422, { error: "Some fields are invalid.", fieldErrors: { turnaroundMinutes: "Turnaround time must be a whole number of minutes, 0 or more." } });
    render(<VenueDetail venue={venue({ can_edit_timing: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit times" }));

    fireEvent.click(screen.getByRole("button", { name: "Save times" }));

    expect(await screen.findByText(/Turnaround time must be a whole number/)).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("101-S4: a 403 message from the server is shown", async () => {
    mockServer(403, { error: "Only venue staff can change a venue's setup and turnaround times." });
    render(<VenueDetail venue={venue({ can_edit_timing: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit times" }));

    fireEvent.click(screen.getByRole("button", { name: "Save times" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Only venue staff");
  });
});

describe("SCRUM-101/AC1 putVenueTiming", () => {
  it("101-S1: reports an unreachable server instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const result = await putVenueTiming("orchid", { setupMinutes: 1, turnaroundMinutes: 1 });
    expect(result.ok).toBe(false);
    expect(result.data.error).toMatch(/couldn't reach the server/);
  });
});
