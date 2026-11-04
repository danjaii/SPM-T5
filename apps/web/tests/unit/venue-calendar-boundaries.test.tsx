// SCRUM-84: the edges of the date rules (AC5, AC6) and what stays on screen after a refusal

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { calendarFixture, jsonReply, venueFixture } from "./venue-calendar-fixtures";

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-84/AC6 an end date equal to the start date is allowed", () => {
  it("SCRUM-84/AC6 asks for that one day, with no error, when start and end are the same date", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async () => jsonReply(200, calendarFixture()));
    vi.stubGlobal("fetch", fetchMock);
    render(<VenueCalendar />);
    await screen.findByText("Orchid Hall");

    type("Start date", "2026-12-01");
    type("End date", "2026-12-01");
    fireEvent.click(screen.getByRole("button", { name: "Show calendar" }));

    await screen.findByText("Orchid Hall");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe("http://localhost:4003/venue-calendar?from=2026-12-01&to=2026-12-01");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("SCRUM-84/AC6 a refused range keeps the previous view and says which range is shown", () => {
  it("SCRUM-84/AC6 still shows the earlier venues and the earlier range after the service answers 422", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(async (url) =>
      url.includes("from=2026-12-01")
        ? jsonReply(422, { code: "VALIDATION_FAILED", fieldErrors: { from: "The start date is not available." } })
        : jsonReply(200, calendarFixture({ venues: [venueFixture({ name: "Kept Hall" })] })),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<VenueCalendar />);
    await screen.findByText("Kept Hall");

    type("Start date", "2026-12-01");
    fireEvent.click(screen.getByRole("button", { name: "Show calendar" }));

    expect(await screen.findByText("The start date is not available.")).toBeTruthy();
    expect(screen.getByText("Kept Hall")).toBeTruthy();
    expect(screen.getByText(/^Showing 2026-11-14/)).toBeTruthy();
  });
});
