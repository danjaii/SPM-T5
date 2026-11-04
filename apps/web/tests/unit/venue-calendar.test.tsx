import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import VenueCalendarPage from "@/app/venue-calendar/page";
import Loading from "@/app/venue-calendar/loading";
import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { calendarFixture, jsonReply, openPeriod, venueFixture } from "./venue-calendar-fixtures";

// ----------------------------------------------------------------------------
// Test setup: a pretend venue-service. `reply` is what GET /venue-calendar answers (null: the request itself fails).
// ----------------------------------------------------------------------------
function mockServer(...replies: (ReturnType<typeof jsonReply> | null)[]) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => {
    const next = replies.length > 1 ? replies.shift() : replies[0];
    if (!next) throw new TypeError("fetch failed");
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => replace.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-84/AC1 open the venue availability calendar", () => {
  it("SCRUM-84/AC1 asks for the current week (no dates) with the login cookie, and never from a cache", async () => {
    const fetchMock = mockServer(jsonReply(200, calendarFixture()));
    render(<VenueCalendar />);
    await screen.findByText("Orchid Hall");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:4003/venue-calendar");
    expect(init?.credentials).toBe("include");
    expect(init?.cache).toBe("no-store");
  });

  it("SCRUM-84/AC1 shows every venue by name with its address and capacity, and its status text for the week", async () => {
    mockServer(jsonReply(200, calendarFixture()));
    render(<VenueCalendar />);
    const orchid = (await screen.findByRole("region", { name: "Orchid Hall" }));
    expect(within(orchid).getByText(/1 Marina Boulevard/)).toBeTruthy();
    expect(within(orchid).getByText(/150/)).toBeTruthy();
    expect(within(orchid).getByText("Available")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Jasmine Room" })).toBeTruthy();
  });

  it("SCRUM-84/AC1 says so when there are no venues", async () => {
    mockServer(jsonReply(200, calendarFixture({ venues: [] })));
    render(<VenueCalendar />);
    expect(await screen.findByText("There are no venues to show.")).toBeTruthy();
  });

  it("SCRUM-84/AC1 shows a loading state until the answer arrives", async () => {
    mockServer(jsonReply(200, calendarFixture()));
    render(<VenueCalendar />);
    expect(screen.getByRole("status", { name: "Loading the venue calendar" })).toBeTruthy();
    await screen.findByText("Orchid Hall");
    expect(screen.queryByRole("status", { name: "Loading the venue calendar" })).toBeNull();
  });

  it("SCRUM-84/AC1 shows an error when the service cannot be reached or fails", async () => {
    mockServer(null);
    const { unmount } = render(<VenueCalendar />);
    expect((await screen.findByRole("alert")).textContent).toContain("We couldn't reach the venue service");
    unmount();
    mockServer(jsonReply(500, { error: "Boom." }));
    render(<VenueCalendar />);
    expect((await screen.findByRole("alert")).textContent).toContain("Boom.");
  });

  it("SCRUM-84/AC1 falls back to a general message when the failure has no message", async () => {
    mockServer({ ok: false, status: 500, json: async () => { throw new Error("no body"); } } as never);
    render(<VenueCalendar />);
    expect((await screen.findByRole("alert")).textContent).toContain("Something went wrong. Please try again.");
  });

  it("SCRUM-84/AC1 sends a signed-out visitor to sign in", async () => {
    mockServer(jsonReply(401, { code: "UNAUTHENTICATED", error: "Not signed in." }));
    render(<VenueCalendar />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("SCRUM-84/AC1 the route has a heading", () => {
    mockServer(jsonReply(200, calendarFixture()));
    render(<VenueCalendarPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Venue calendar" })).toBeTruthy();
  });

  it("SCRUM-84/AC1 the route shows its shape while it loads", () => {
    render(<Loading />);
    expect(screen.getByLabelText("Loading the venue calendar").getAttribute("aria-busy")).toBe("true");
  });

  it("SCRUM-84/AC1 an open period with the status text 'Available' is listed for a venue with no bookings", async () => {
    mockServer(jsonReply(200, calendarFixture({ venues: [venueFixture({ id: "v", name: "Quiet Room", periods: [openPeriod()] })] })));
    render(<VenueCalendar />);
    const quiet = await screen.findByRole("region", { name: "Quiet Room" });
    expect(within(quiet).getAllByRole("listitem")).toHaveLength(1);
  });
});
