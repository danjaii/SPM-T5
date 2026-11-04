// SCRUM-130/AC3: Venue Staff mark a venue unavailable from the calendar (Figma 09's "Mark venue unavailable"), and it shows straight
// away. The clock is Saturday 14 Nov 2026, 10:15 in Singapore; 10:00 is 02:00Z.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/venueUnavailability", () => ({ postVenueUnavailability: post }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { calendarFixture, jsonReply, openPeriod, venueFixture } from "./venue-calendar-fixtures";

const NOW = new Date("2026-11-14T02:15:00.000Z");
const Z = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 14, h - 8, m)).toISOString();
};
const blockAfter = { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("09:00"), end: Z("11:00"), reason: "maintenance", reason_label: "Maintenance", overlaps_confirmed_booking: false };
const MARK = { name: "Mark venue unavailable" };

const fill = (dialog: HTMLElement) => {
  for (const [label, value] of [["Start date", "2026-11-14"], ["Start time", "09:00"], ["End date", "2026-11-14"], ["End time", "11:00"]]) {
    fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
  }
  fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "maintenance" } });
};

beforeEach(() => post.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-130/AC3 Venue Staff mark a venue unavailable from the calendar", () => {
  it("SCRUM-130/AC3 offers Mark venue unavailable to Venue Staff only, once for the page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture())));
    const { unmount } = render(<VenueCalendar canMarkUnavailable now={NOW} />);
    await screen.findByText("Jasmine Room");
    expect(screen.getAllByRole("button", MARK)).toHaveLength(1);
    unmount();
    render(<VenueCalendar now={NOW} />);
    await screen.findByText("Jasmine Room");
    expect(screen.queryByRole("button", MARK)).toBeNull();
  });

  it("SCRUM-130/AC3 is not offered while there are no venues to mark", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ venues: [] }))));
    render(<VenueCalendar canMarkUnavailable now={NOW} />);
    await screen.findByText("There are no venues to show.");
    expect((screen.getByRole("button", MARK) as HTMLButtonElement).disabled).toBe(true);
  });

  it("SCRUM-130/AC3 saves from a dialog and shows the new block straight away, without leaving the page", async () => {
    const answers = [
      calendarFixture({ venues: [venueFixture({ periods: [openPeriod()] })] }),
      calendarFixture({ venues: [venueFixture({ periods: [blockAfter] })] }),
    ];
    const fetchMock = vi.fn(async () => jsonReply(200, answers.shift() ?? answers[0]));
    vi.stubGlobal("fetch", fetchMock);
    post.mockResolvedValue({ ok: true, data: { affectedBookings: 0 } });
    render(<VenueCalendar canMarkUnavailable now={NOW} />);
    await screen.findByText("Orchid Hall");

    fireEvent.click(screen.getByRole("button", MARK));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Mark Orchid Hall unavailable")).toBeTruthy();
    fill(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save unavailable period" }));

    expect(await screen.findByText("Blocked: Maintenance")).toBeTruthy();
    expect(post).toHaveBeenCalledWith("orchid", expect.objectContaining({ startDate: "2026-11-14", endTime: "11:00", reason: "maintenance" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls as unknown as string[][])[1][0]).toBe((fetchMock.mock.calls as unknown as string[][])[0][0]); // the same day again, not another range
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("SCRUM-130/AC3 reloads the dates on screen, not today, after a save", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { urls.push(url); return jsonReply(200, calendarFixture()); }));
    post.mockResolvedValue({ ok: true, data: { affectedBookings: 0 } });
    render(<VenueCalendar canMarkUnavailable now={NOW} />);
    await screen.findByText("Orchid Hall");
    fireEvent.click(screen.getByRole("tab", { name: "Week" }));
    await waitFor(() => expect(urls).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", MARK));
    fill(await screen.findByRole("dialog"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save unavailable period" }));

    await waitFor(() => expect(urls).toHaveLength(3));
    expect(urls[2]).toBe(urls[1]);
    expect(urls[2]).toContain("from=2026-11-09&to=2026-11-15");
  });

  it("SCRUM-130/AC3 posts to the venue chosen in the dialog, and names it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture())));
    post.mockResolvedValue({ ok: true, data: { affectedBookings: 0 } });
    render(<VenueCalendar canMarkUnavailable now={NOW} />);
    await screen.findByText("Jasmine Room");
    fireEvent.click(screen.getByRole("button", MARK));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Venue"), { target: { value: "jasmine" } });
    expect(within(dialog).getByText("Mark Jasmine Room unavailable")).toBeTruthy();
    fill(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save unavailable period" }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe("jasmine");
  });

  it("SCRUM-130/AC3 shows why a save failed, keeps the dialog and what was typed, and leaves the calendar unchanged", async () => {
    const fetchMock = vi.fn(async () => jsonReply(200, calendarFixture({ venues: [venueFixture({ periods: [openPeriod()] })] })));
    vi.stubGlobal("fetch", fetchMock);
    post.mockResolvedValue({ ok: false, data: { error: "Only venue staff can mark a venue unavailable." } });
    render(<VenueCalendar canMarkUnavailable now={NOW} />);
    await screen.findByText("Orchid Hall");
    fireEvent.click(screen.getByRole("button", MARK));
    const dialog = await screen.findByRole("dialog");
    fill(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save unavailable period" }));

    expect((await within(dialog).findByRole("alert")).textContent).toContain("Only venue staff can mark a venue unavailable.");
    expect((within(dialog).getByLabelText("End time") as HTMLInputElement).value).toBe("11:00");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /^Details: Blocked/ })).toBeNull();
  });
});
