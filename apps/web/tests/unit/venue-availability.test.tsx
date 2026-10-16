import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { cookieValue, redirect } = vi.hoisted(() => ({
  cookieValue: { current: "token-123" as string | undefined },
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookieValue.current ? { value: cookieValue.current } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const { getVenueAvailability } = vi.hoisted(() => ({ getVenueAvailability: vi.fn() }));
vi.mock("@/lib/venueAvailabilityServer", () => ({ getVenueAvailability }));

import VenueAvailabilityPage from "@/app/venues/[id]/availability/page";
import { VenueAvailabilityDay } from "@/components/VenueAvailabilityDay";
import { VenueDetail } from "@/components/VenueDetail";
import type { VenueAvailabilityData } from "@/lib/venueAvailability";

// 2026-11-14 in Singapore time (UTC+8): 10:00 is 02:00Z.
const data = (extra: Partial<VenueAvailabilityData> = {}): VenueAvailabilityData => ({
  venue: { id: "orchid", name: "Orchid Hall" },
  date: "2026-11-14",
  setup_minutes: 30,
  turnaround_minutes: 45,
  periods: [
    {
      status: "APPROVED",
      event_start: "2026-11-14T02:00:00.000Z",
      event_end: "2026-11-14T04:00:00.000Z",
      occupied_start: "2026-11-14T01:30:00.000Z",
      occupied_end: "2026-11-14T04:45:00.000Z",
    },
  ],
  ...extra,
});

beforeEach(() => {
  cookieValue.current = "token-123";
  redirect.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SCRUM-103/AC5 the availability day separates the event from setup and turnaround (103-S5)", () => {
  it("103-S5: shows occupied 09:30 to 12:45 and labels the three segments in text", () => {
    render(<VenueAvailabilityDay data={data()} />);

    expect(screen.getByRole("heading", { name: /Orchid Hall/ })).toBeTruthy();
    const item = screen.getByRole("listitem");
    expect(within(item).getByText(/Occupied 09:30 to 12:45/)).toBeTruthy();
    expect(within(item).getByText("Setup 09:30 to 10:00")).toBeTruthy();
    expect(within(item).getByText("Event 10:00 to 12:00")).toBeTruthy();
    expect(within(item).getByText("Turnaround 12:00 to 12:45")).toBeTruthy();
    expect(within(item).getByText("Approved")).toBeTruthy();
  });

  it("103-S5: a Pending booking is labelled Pending", () => {
    render(<VenueAvailabilityDay data={data({ periods: [{ ...data().periods[0], status: "PENDING" }] })} />);
    expect(screen.getByText("Pending")).toBeTruthy();
  });

  it("103-S6: a venue with no times shows only the event", () => {
    const zero = { ...data().periods[0], occupied_start: "2026-11-14T02:00:00.000Z", occupied_end: "2026-11-14T04:00:00.000Z" };
    render(<VenueAvailabilityDay data={data({ setup_minutes: 0, turnaround_minutes: 0, periods: [zero] })} />);

    expect(screen.getByText(/Occupied 10:00 to 12:00/)).toBeTruthy();
    expect(screen.getByText("Event 10:00 to 12:00")).toBeTruthy();
    expect(screen.queryByText(/^Setup /)).toBeNull();
    expect(screen.queryByText(/^Turnaround /)).toBeNull();
  });

  it("103-S5: states the venue's times and offers a date picker set to the day", () => {
    render(<VenueAvailabilityDay data={data()} />);
    expect(screen.getByText(/setup 30 minutes, turnaround 45 minutes/)).toBeTruthy();
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-11-14");
    expect(screen.getByRole("button", { name: "Show day" })).toBeTruthy();
  });

  it("103-S5: a day with no bookings says so", () => {
    render(<VenueAvailabilityDay data={data({ periods: [] })} />);
    expect(screen.getByText(/No bookings on 2026-11-14/)).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("103-S5: a period that starts the evening before shows its date", () => {
    const overnight = {
      status: "APPROVED" as const,
      event_start: "2026-11-13T15:00:00.000Z", // 23:00 on the 13th
      event_end: "2026-11-13T15:50:00.000Z",
      occupied_start: "2026-11-13T14:30:00.000Z",
      occupied_end: "2026-11-13T16:35:00.000Z", // 00:35 on the 14th
    };
    render(<VenueAvailabilityDay data={data({ periods: [overnight] })} />);
    expect(screen.getByText(/Occupied 2026-11-13 22:30 to 00:35/)).toBeTruthy();
  });
});

describe("SCRUM-103/AC5 the availability page", () => {
  it("103-S5: loads the day asked for in the address and shows it", async () => {
    getVenueAvailability.mockResolvedValue({ data: data() });
    render(await VenueAvailabilityPage({ params: Promise.resolve({ id: "orchid" }), searchParams: Promise.resolve({ date: "2026-11-14" }) }));

    expect(getVenueAvailability).toHaveBeenCalledWith("orchid", "2026-11-14");
    expect(screen.getByText("Setup 09:30 to 10:00")).toBeTruthy();
    expect(screen.getByRole("link", { name: /back to venue/i }).getAttribute("href")).toBe("/venues/orchid");
  });

  it("103-S5: with no date it asks for today in Singapore", async () => {
    getVenueAvailability.mockResolvedValue({ data: data() });
    await VenueAvailabilityPage({ params: Promise.resolve({ id: "orchid" }), searchParams: Promise.resolve({}) });
    expect(getVenueAvailability.mock.calls.at(-1)?.[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("103-S5: shows the service's message when the view is refused", async () => {
    getVenueAvailability.mockResolvedValue({ error: "You are not allowed to view the venue catalogue." });
    render(await VenueAvailabilityPage({ params: Promise.resolve({ id: "orchid" }), searchParams: Promise.resolve({ date: "2026-11-14" }) }));
    expect(screen.getByRole("alert").textContent).toContain("not allowed");
  });
});

describe("SCRUM-103/AC5 getVenueAvailability", () => {
  let realLoader: typeof import("@/lib/venueAvailabilityServer")["getVenueAvailability"];
  beforeEach(async () => {
    realLoader = (await vi.importActual<typeof import("@/lib/venueAvailabilityServer")>("@/lib/venueAvailabilityServer")).getVenueAvailability;
  });

  const mockServer = (status: number, body: unknown) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("103-S5: asks venue-service for the day as the signed-in user", async () => {
    const fetchMock = mockServer(200, data());
    expect(await realLoader("orchid", "2026-11-14")).toEqual({ data: data() });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/venues\/orchid\/availability\?date=2026-11-14$/);
    expect(init.headers.cookie).toContain("token-123");
  });

  it("103-S5: passes the service's message on, and sends a signed-out visitor to sign in", async () => {
    mockServer(404, { error: "Venue not found." });
    expect(await realLoader("nope", "2026-11-14")).toEqual({ error: "Venue not found." });

    mockServer(401, {});
    await expect(realLoader("orchid", "2026-11-14")).rejects.toThrow("redirect:/login");

    cookieValue.current = undefined;
    await expect(realLoader("orchid", "2026-11-14")).rejects.toThrow("redirect:/login");
  });

  it("103-S5: reports an unreachable service", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await realLoader("orchid", "2026-11-14")).toEqual({ error: "We couldn't reach the venue service. Please try again." });
  });
});

describe("SCRUM-103/AC5 the venue page links to the availability", () => {
  it("103-S5: VenueDetail links to the venue's availability", () => {
    render(
      <VenueDetail
        venue={{
          id: "orchid", name: "Orchid Hall", address: "x", description: null, max_capacity: 150, operating_hours_start: null,
          operating_hours_end: null, is_accessible: true, accessibility_notes: null, layouts: [], facilities: [],
          setup_minutes: 30, turnaround_minutes: 45, can_edit_timing: false,
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "View availability" }).getAttribute("href")).toBe("/venues/orchid/availability");
  });
});
