// SCRUM-130: the calendar page on a wide screen shows the week grid with a legend; Mark unavailable, the footnote and the empty,
// loading and error states keep working there. (The narrow list is covered by the SCRUM-84, 85 and 130 list tests, which run without
// a media query and so see the fallback.)

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/venueUnavailability", () => ({ postVenueUnavailability: post }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { calendarFixture, jsonReply, openPeriod, venueFixture } from "./venue-calendar-fixtures";

const Z = (hhmm: string) => new Date(Date.UTC(2026, 10, 14, Number(hhmm.slice(0, 2)) - 8, Number(hhmm.slice(3)))).toISOString();
const WEEK = { from: "2026-11-09", to: "2026-11-15", start: "2026-11-08T16:00:00.000Z", end: "2026-11-15T16:00:00.000Z", time_zone: "Asia/Singapore" };

function wide(matches = true) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}
beforeEach(() => post.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-130/AC1 the page shows a week grid per venue on a wide screen", () => {
  it("SCRUM-130/AC1 shows one grid for each venue, for the week the service sent, and no list", async () => {
    wide();
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ range: WEEK }))));
    render(<VenueCalendar />);

    expect(await screen.findByRole("region", { name: "Orchid Hall, week of Mon 9 Nov" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Jasmine Room, week of Mon 9 Nov" })).toBeTruthy();
    expect(screen.queryAllByRole("listitem").filter((li) => li.getAttribute("data-kind"))).toHaveLength(0);
  });

  it("SCRUM-130/AC5 explains every status in a legend, with its icon and words, and the dashed padding", async () => {
    wide();
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ range: WEEK }))));
    render(<VenueCalendar />);
    await screen.findByRole("region", { name: /Orchid Hall, week of/ });

    const legend = within(screen.getByRole("list", { name: "Legend" }));
    for (const label of ["Confirmed", "Tentatively Held", "Blocked", "Available", "Unavailable", "Setup and turnaround"]) {
      expect(legend.getByText(label)).toBeTruthy();
    }
    for (const item of legend.getAllByRole("listitem")) expect(item.querySelector("svg, [data-swatch]")).not.toBeNull();
    expect(screen.getByText(/Dashed rows either side of each booking/)).toBeTruthy();
  });

  it("SCRUM-130/AC1 shows no legend and no grid on a narrow screen, where the list is used", async () => {
    wide(false);
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ range: WEEK }))));
    render(<VenueCalendar />);
    await screen.findAllByText("Orchid Hall");
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
    expect(screen.queryByRole("region", { name: /week of/ })).toBeNull();
  });
});

describe("SCRUM-130/AC3 Mark unavailable from the grid page", () => {
  const blockAfter = { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("09:00"), end: Z("11:00"), reason: "maintenance", reason_label: "Maintenance", overlaps_confirmed_booking: false };

  it("SCRUM-130/AC3 saves from the dialog and shows the new block in its day column straight away", async () => {
    wide();
    const answers = [
      calendarFixture({ range: WEEK, venues: [venueFixture({ periods: [openPeriod()] })] }),
      calendarFixture({ range: WEEK, venues: [venueFixture({ periods: [blockAfter] })] }),
    ];
    const fetchMock = vi.fn(async () => jsonReply(200, answers.shift() ?? answers[0]));
    vi.stubGlobal("fetch", fetchMock);
    post.mockResolvedValue({ ok: true, data: { affectedBookings: 0 } });
    render(<VenueCalendar canMarkUnavailable />);
    await screen.findByRole("region", { name: /Orchid Hall, week of/ });

    fireEvent.click(screen.getByRole("button", { name: "Mark Orchid Hall unavailable" }));
    const dialog = await screen.findByRole("dialog");
    for (const [label, value] of [["Start date", "2026-11-14"], ["Start time", "09:00"], ["End date", "2026-11-14"], ["End time", "11:00"]]) {
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    }
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "maintenance" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save unavailable period" }));

    await waitFor(() => expect(within(screen.getByRole("group", { name: "Sat 14 Nov" })).getByRole("button", { name: /Details: Blocked/ })).toBeTruthy());
    expect(post).toHaveBeenCalledWith("orchid", expect.objectContaining({ startDate: "2026-11-14", endTime: "11:00", reason: "maintenance" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("SCRUM-130/AC3 offers the button to Venue Staff only", async () => {
    wide();
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ range: WEEK }))));
    render(<VenueCalendar />);
    await screen.findByRole("region", { name: /Orchid Hall, week of/ });
    expect(screen.queryByRole("button", { name: /Mark .* unavailable/ })).toBeNull();
  });
});

describe("SCRUM-130/AC9 empty, loading and error states on a wide screen", () => {
  it("SCRUM-130/AC9 says so when there are no venues, with no legend", async () => {
    wide();
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ range: WEEK, venues: [] }))));
    render(<VenueCalendar />);
    expect(await screen.findByText("There are no venues to show.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
  });

  it("SCRUM-130/AC9 shows the loading state while the calendar loads", () => {
    wide();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(<VenueCalendar />);
    expect(screen.getByRole("status", { name: "Loading the venue calendar" })).toBeTruthy();
  });

  it("SCRUM-130/AC9 shows an error, not an empty grid, when the service fails", async () => {
    wide();
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(500, { error: "Something went wrong. Please try again." })));
    render(<VenueCalendar />);
    expect((await screen.findByRole("alert")).textContent).toContain("Something went wrong");
    expect(screen.queryByRole("region", { name: /week of/ })).toBeNull();
  });
});
