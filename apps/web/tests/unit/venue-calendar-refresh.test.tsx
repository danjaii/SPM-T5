import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { calendarFixture, jsonReply, openPeriod, venueFixture } from "./venue-calendar-fixtures";

afterEach(() => vi.unstubAllGlobals());

const held = { kind: "event", status: "TENTATIVELY_HELD", label: "Tentatively Held", start: "2026-11-14T02:00:00.000Z", end: "2026-11-14T04:00:00.000Z" };

describe("SCRUM-84/AC7 the latest recorded status", () => {
  it("SCRUM-84/AC7 reloading asks venue-service again for the same range and shows the new status", async () => {
    const answers = [
      calendarFixture({ venues: [venueFixture({ periods: [openPeriod()] })] }),
      calendarFixture({ venues: [venueFixture({ periods: [held] })] }),
      calendarFixture({ venues: [venueFixture({ periods: [{ ...held, status: "CONFIRMED", label: "Confirmed" }] })] }),
    ];
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonReply(200, answers.shift()));
    vi.stubGlobal("fetch", fetchMock);
    render(<VenueCalendar />);
    await screen.findByText("Available");

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-11-14" } });
    fireEvent.click(screen.getByRole("button", { name: "Show calendar" }));
    await screen.findByText("Tentatively Held");

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await screen.findByText("Confirmed");
    expect(screen.queryByText("Tentatively Held")).toBeNull();
    expect(fetchMock.mock.calls[2][0]).toBe("http://localhost:4003/venue-calendar?from=2026-11-14");
    expect(fetchMock.mock.calls[2][1]?.cache).toBe("no-store");
  });

  it("SCRUM-84/AC7 reloading with nothing chosen asks for the current week", async () => {
    const fetchMock = vi.fn(async (_url: string) => jsonReply(200, calendarFixture()));
    vi.stubGlobal("fetch", fetchMock);
    render(<VenueCalendar />);
    await screen.findByText("Orchid Hall");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:4003/venue-calendar");
  });
});
