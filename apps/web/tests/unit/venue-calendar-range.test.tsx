import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { calendarFixture, jsonReply, venueFixture } from "./venue-calendar-fixtures";

// A pretend venue-service that answers each request from `answer(url)`.
function mockServer(answer: (url: string) => ReturnType<typeof jsonReply> | null) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async (url) => {
    const reply = answer(url);
    if (!reply) throw new TypeError("fetch failed");
    return reply;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const rangeOf = (from: string, to: string) => ({ from, to, start: `${from}T00:00:00.000Z`, end: `${to}T00:00:00.000Z`, time_zone: "Asia/Singapore" });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.clearAllMocks());

describe("SCRUM-84/AC5 change the date range", () => {
  it("SCRUM-84/AC5 asks for one day when only a start date is chosen, and shows that day", async () => {
    const fetchMock = mockServer((url) =>
      url.includes("from=2026-12-01")
        ? jsonReply(200, calendarFixture({ range: rangeOf("2026-12-01", "2026-12-01"), venues: [venueFixture({ name: "Dec Hall" })] }))
        : jsonReply(200, calendarFixture()),
    );
    render(<VenueCalendar />);
    await screen.findByText("Orchid Hall");

    type("Start date", "2026-12-01");
    fireEvent.click(screen.getByRole("button", { name: "Show calendar" }));

    expect(await screen.findByText("Dec Hall")).toBeTruthy();
    expect(screen.queryByText("Orchid Hall")).toBeNull();
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("http://localhost:4003/venue-calendar?from=2026-12-01");
    expect(screen.getByText("Showing 2026-12-01")).toBeTruthy();
  });

  it("SCRUM-84/AC5 asks for exactly the start and end dates chosen, and shows that range", async () => {
    const fetchMock = mockServer((url) =>
      jsonReply(200, url.includes("to=") ? calendarFixture({ range: rangeOf("2026-11-30", "2026-12-06") }) : calendarFixture()),
    );
    render(<VenueCalendar />);
    await screen.findByText("Orchid Hall");

    type("Start date", "2026-11-30");
    type("End date", "2026-12-06");
    fireEvent.click(screen.getByRole("button", { name: "Show calendar" }));

    await screen.findByText("Showing 2026-11-30 to 2026-12-06");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("http://localhost:4003/venue-calendar?from=2026-11-30&to=2026-12-06");
  });

  it("SCRUM-84/AC5 tells the viewer the current week is shown to begin with, and that an empty end date means one day", async () => {
    mockServer(() => jsonReply(200, calendarFixture({ range: rangeOf("2026-11-09", "2026-11-15") })));
    render(<VenueCalendar />);
    await screen.findByText("Showing 2026-11-09 to 2026-11-15");
    expect(screen.getByText("Leave the end date empty to see a single day.")).toBeTruthy();
  });

  it("SCRUM-84/AC5 keeps the old view on screen, marked busy, while the new range loads", async () => {
    let release: (reply: unknown) => void = () => {};
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("from=") ? new Promise((resolve) => (release = resolve)) : jsonReply(200, calendarFixture()),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VenueCalendar />);
    await screen.findByText("Orchid Hall");
    type("Start date", "2026-12-01");
    fireEvent.click(screen.getByRole("button", { name: "Show calendar" }));
    expect(screen.getByText("Orchid Hall")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Show calendar" }) as HTMLButtonElement).disabled).toBe(true);
    release(jsonReply(200, calendarFixture()));
    await waitFor(() => expect((screen.getByRole("button", { name: "Show calendar" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("SCRUM-84/AC5 drops the answer of a request that a newer choice replaced", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      url.includes("from=2026-12-01")
        ? new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
        : Promise.resolve(jsonReply(200, url.includes("from=2026-12-02") ? calendarFixture({ venues: [venueFixture({ name: "Second Hall" })] }) : calendarFixture())),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VenueCalendar />);
    await screen.findByText("Orchid Hall");
    type("Start date", "2026-12-01");
    fireEvent.click(screen.getByRole("button", { name: "Show calendar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // the button is disabled while loading, so submit the form itself as a second quick choice
    type("Start date", "2026-12-02");
    fireEvent.submit(screen.getByRole("form", { name: "Date range" }));
    expect(await screen.findByText("Second Hall")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
