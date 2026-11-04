// SCRUM-84 and SCRUM-130 (Figma 09): open the venue calendar, move between Day, Week and Month, step through dates, and see the
// service's answer, its refusals and its errors. The clock is Saturday 14 Nov 2026, 10:15 in Singapore (02:15Z).

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import VenueCalendarPage from "@/app/venue-calendar/page";
import Loading from "@/app/venue-calendar/loading";
import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { calendarFixture, jsonReply, openPeriod, venueFixture } from "./venue-calendar-fixtures";

const NOW = new Date("2026-11-14T02:15:00.000Z");
const URL = "http://localhost:4003/venue-calendar";
const rangeOf = (from: string, to: string) => ({ from, to, start: `${from}T00:00:00.000Z`, end: `${to}T00:00:00.000Z`, time_zone: "Asia/Singapore" });

// A pretend venue-service: each reply in turn (the last one repeats); null means the request itself fails.
function mockServer(...replies: (ReturnType<typeof jsonReply> | null)[]) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => {
    const next = replies.length > 1 ? replies.shift() : replies[0];
    if (!next) throw new TypeError("fetch failed");
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const lastUrl = (fetchMock: ReturnType<typeof mockServer>) => fetchMock.mock.calls.at(-1)?.[0];

beforeEach(() => replace.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-84/AC1 open the venue availability calendar", () => {
  it("SCRUM-84/AC1 asks for today with the login cookie, and never from a cache", async () => {
    const fetchMock = mockServer(jsonReply(200, calendarFixture()));
    render(<VenueCalendar now={NOW} />);
    await screen.findByText("Orchid Hall");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${URL}?from=2026-11-14&to=2026-11-14`);
    expect(init?.credentials).toBe("include");
    expect(init?.cache).toBe("no-store");
  });

  it("SCRUM-84/AC1 shows every venue as a row with its name and capacity, and its free time as Available", async () => {
    mockServer(jsonReply(200, calendarFixture()));
    render(<VenueCalendar now={NOW} />);
    const rows = await waitFor(() => {
      const found = document.querySelectorAll("[data-venue-row]");
      expect(found).toHaveLength(2);
      return [...found] as HTMLElement[];
    });
    expect(within(rows[0]).getByText("Orchid Hall")).toBeTruthy();
    expect(within(rows[0]).getByText("Capacity 150")).toBeTruthy();
    expect(within(rows[0]).getByRole("button", { name: /^Details: Available/ })).toBeTruthy();
    expect(within(rows[1]).getByText("Jasmine Room")).toBeTruthy();
  });

  it("SCRUM-84/AC1 says so when there are no venues", async () => {
    mockServer(jsonReply(200, calendarFixture({ venues: [] })));
    render(<VenueCalendar now={NOW} />);
    expect(await screen.findByText("There are no venues to show.")).toBeTruthy();
  });

  it("SCRUM-84/AC1 shows a loading state until the answer arrives", async () => {
    mockServer(jsonReply(200, calendarFixture()));
    render(<VenueCalendar now={NOW} />);
    expect(screen.getByRole("status", { name: "Loading the venue calendar" })).toBeTruthy();
    await screen.findByText("Orchid Hall");
    expect(screen.queryByRole("status", { name: "Loading the venue calendar" })).toBeNull();
  });

  it("SCRUM-84/AC1 shows an error when the service cannot be reached or fails", async () => {
    mockServer(null);
    const { unmount } = render(<VenueCalendar now={NOW} />);
    expect((await screen.findByRole("alert")).textContent).toContain("We couldn't reach the venue service");
    unmount();
    mockServer(jsonReply(500, { error: "Boom." }));
    render(<VenueCalendar now={NOW} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Boom.");
  });

  it("SCRUM-84/AC1 falls back to a general message when the failure has no message", async () => {
    mockServer({ ok: false, status: 500, json: async () => { throw new Error("no body"); } } as never);
    render(<VenueCalendar now={NOW} />);
    expect((await screen.findByRole("alert")).textContent).toContain("Something went wrong. Please try again.");
  });

  it("SCRUM-84/AC1 sends a signed-out visitor to sign in", async () => {
    mockServer(jsonReply(401, { code: "UNAUTHENTICATED", error: "Not signed in." }));
    render(<VenueCalendar now={NOW} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("SCRUM-84/AC1 the route has its heading while the calendar loads", () => {
    mockServer(jsonReply(200, calendarFixture()));
    render(<VenueCalendarPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Venue calendar" })).toBeTruthy();
  });

  it("SCRUM-84/AC1 the route shows its shape while it loads", () => {
    render(<Loading />);
    expect(screen.getByLabelText("Loading the venue calendar", { selector: "main" }).getAttribute("aria-busy")).toBe("true");
  });

  it("SCRUM-130 shows the heading it is given beside the calendar", async () => {
    mockServer(jsonReply(200, calendarFixture()));
    render(<VenueCalendar now={NOW} heading={<h1>Venue calendar</h1>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Venue calendar" })).toBeTruthy();
    await screen.findByText("Orchid Hall");
  });
});

describe("SCRUM-84/AC5 change the date range (Figma 09: Day, Week, Month and the date stepper)", () => {
  it("SCRUM-84/AC5 asks for the week and the month around the day shown, and back to one day", async () => {
    const fetchMock = mockServer(jsonReply(200, calendarFixture()));
    render(<VenueCalendar now={NOW} />);
    await screen.findByText("Orchid Hall");

    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    await waitFor(() => expect(lastUrl(fetchMock)).toBe(`${URL}?from=2026-11-09&to=2026-11-15`));
    expect(screen.getByText("9–15 Nov 2026")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Month" }));
    await waitFor(() => expect(lastUrl(fetchMock)).toBe(`${URL}?from=2026-11-01&to=2026-11-30`));
    expect(screen.getByText("November 2026")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Day" }));
    await waitFor(() => expect(lastUrl(fetchMock)).toBe(`${URL}?from=2026-11-14&to=2026-11-14`));
    expect(screen.getByText("Sat 14 Nov")).toBeTruthy();
  });

  it("SCRUM-84/AC5 steps to the previous and next day, week or month, and Today comes back", async () => {
    const fetchMock = mockServer(jsonReply(200, calendarFixture()));
    render(<VenueCalendar now={NOW} />);
    await screen.findByText("Orchid Hall");

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await waitFor(() => expect(lastUrl(fetchMock)).toBe(`${URL}?from=2026-11-15&to=2026-11-15`));
    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    await waitFor(() => expect(lastUrl(fetchMock)).toBe(`${URL}?from=2026-11-09&to=2026-11-15`));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(lastUrl(fetchMock)).toBe(`${URL}?from=2026-11-16&to=2026-11-22`));
    fireEvent.click(screen.getByRole("tab", { name: "Month" }));
    await waitFor(() => expect(lastUrl(fetchMock)).toBe(`${URL}?from=2026-11-01&to=2026-11-30`));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(lastUrl(fetchMock)).toBe(`${URL}?from=2026-10-01&to=2026-10-31`));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(lastUrl(fetchMock)).toBe(`${URL}?from=2026-11-01&to=2026-11-30`));
  });

  it("SCRUM-84/AC5 opens a day from a week or month cell", async () => {
    const fetchMock = mockServer(jsonReply(200, calendarFixture()));
    render(<VenueCalendar now={NOW} />);
    await screen.findByText("Orchid Hall");
    fireEvent.click(screen.getByRole("tab", { name: "Month" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Open Jasmine Room on Fri 20 Nov/ }));
    await waitFor(() => expect(lastUrl(fetchMock)).toBe(`${URL}?from=2026-11-20&to=2026-11-20`));
    expect(screen.getByRole("tab", { name: "Day" }).getAttribute("aria-selected")).toBe("true");
  });

  it("SCRUM-84/AC5 keeps the old view on screen, marked busy, while the new range loads, and drops a replaced answer", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      url.includes("from=2026-11-15")
        ? new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
        : Promise.resolve(jsonReply(200, url.includes("from=2026-11-14") ? calendarFixture() : calendarFixture({ venues: [venueFixture({ name: "Week Hall" })] }))),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VenueCalendar now={NOW} />);
    await screen.findByText("Orchid Hall");

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByText("Orchid Hall")).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect((screen.getByRole("button", { name: "Next day" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("tab", { name: "Week" })); // a newer choice replaces the hanging one
    expect(await screen.findByText("Week Hall")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("SCRUM-84/AC6 a range the service refuses", () => {
  it("SCRUM-84/AC6 shows the service's own message and keeps the previous view", async () => {
    mockServer(
      jsonReply(200, calendarFixture()),
      jsonReply(422, { code: "VALIDATION_FAILED", error: "Some fields are invalid.", fieldErrors: { to: "Choose a range of 62 days or fewer." } }),
    );
    render(<VenueCalendar now={NOW} />);
    await screen.findByText("Orchid Hall");
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Choose a range of 62 days or fewer.");
    expect(screen.getByText("Orchid Hall")).toBeTruthy();
  });

  it("SCRUM-84/AC6 clears the message once a range is shown", async () => {
    mockServer(
      jsonReply(200, calendarFixture()),
      jsonReply(422, { fieldErrors: { from: "Enter a real date." } }),
      jsonReply(200, calendarFixture({ range: rangeOf("2026-11-14", "2026-11-14") })),
    );
    render(<VenueCalendar now={NOW} />);
    await screen.findByText("Orchid Hall");
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

describe("SCRUM-84/AC7 the latest recorded status", () => {
  it("SCRUM-84/AC7 asks venue-service again when the same day is shown again, and shows the new status", async () => {
    const block = { kind: "block", status: "BLOCKED", label: "Blocked", start: "2026-11-14T01:00:00.000Z", end: "2026-11-14T03:00:00.000Z", reason_label: "Maintenance" };
    const fetchMock = mockServer(
      jsonReply(200, calendarFixture({ venues: [venueFixture({ periods: [openPeriod()] })] })),
      jsonReply(200, calendarFixture({ venues: [venueFixture({ periods: [openPeriod()] })] })),
      jsonReply(200, calendarFixture({ venues: [venueFixture({ periods: [block] })] })),
    );
    render(<VenueCalendar now={NOW} />);
    await screen.findByText("Orchid Hall");
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    expect(await screen.findByText("Blocked: Maintenance")).toBeTruthy();
    expect(fetchMock.mock.calls[2][0]).toBe(fetchMock.mock.calls[0][0]);
  });
});
