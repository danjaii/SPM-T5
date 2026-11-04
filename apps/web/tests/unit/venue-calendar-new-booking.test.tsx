// SCRUM-130 (Figma 09's "+ New booking"): a coordinator picks one of their events and goes to its Request a venue page (SCRUM-32).

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import { NewBookingButton } from "@/components/venue-calendar/NewBookingButton";
import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { calendarFixture, jsonReply } from "./venue-calendar-fixtures";

const events = [{ id: "e1", name: "Tech Summit" }, { id: "e3", name: "Planning Day" }];

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-130 New booking", () => {
  it("SCRUM-130 opens a dialog to choose the event, then links to that event's Request a venue page", async () => {
    render(<NewBookingButton events={events} />);
    fireEvent.click(screen.getByRole("button", { name: "New booking" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "New booking" })).toBeTruthy();
    const link = within(dialog).getByRole("link", { name: "Request a venue" });
    expect(link.getAttribute("href")).toBe("/events/e1/venue-request");
    fireEvent.change(within(dialog).getByLabelText("Event"), { target: { value: "e3" } });
    expect(link.getAttribute("href")).toBe("/events/e3/venue-request");
  });

  it("SCRUM-130 says so when none of the coordinator's events can take a venue request", async () => {
    render(<NewBookingButton events={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "New booking" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/None of your events can take a venue request right now/)).toBeTruthy();
    expect(within(dialog).queryByRole("link")).toBeNull();
  });

  it("SCRUM-130 is on the calendar beside the title only when the page gives it events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture())));
    const { unmount } = render(<VenueCalendar bookableEvents={events} now={new Date("2026-11-14T02:15:00.000Z")} />);
    await screen.findByText("Orchid Hall");
    expect(screen.getByRole("button", { name: "New booking" })).toBeTruthy();
    unmount();
    render(<VenueCalendar canMarkUnavailable now={new Date("2026-11-14T02:15:00.000Z")} />);
    await screen.findByText("Orchid Hall");
    expect(screen.queryByRole("button", { name: "New booking" })).toBeNull();
  });
});
