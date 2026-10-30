// SCRUM-130/AC3: Venue Staff mark a venue unavailable from the calendar, and it shows straight away. 14 Nov 2026 in Singapore: 10:00 is 02:00Z.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/venueUnavailability", () => ({ postVenueUnavailability: post }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { calendarFixture, jsonReply, openPeriod, venueFixture } from "./venue-calendar-fixtures";

const Z = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 10, 14, h - 8, m)).toISOString();
};

describe("SCRUM-130/AC3 Venue Staff mark a venue unavailable from the calendar", () => {
  beforeEach(() => post.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  const blockAfter = { kind: "block", status: "BLOCKED", label: "Blocked", start: Z("09:00"), end: Z("11:00"), reason: "maintenance", reason_label: "Maintenance", overlaps_confirmed_booking: false };

  it("offers Mark unavailable on each venue to Venue Staff only", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture())));
    const { unmount } = render(<VenueCalendar canMarkUnavailable />);
    await screen.findByText("Jasmine Room");
    expect(screen.getAllByRole("button", { name: /Mark .* unavailable/ })).toHaveLength(2);
    unmount();
    render(<VenueCalendar />);
    await screen.findByText("Jasmine Room");
    expect(screen.queryByRole("button", { name: /Mark .* unavailable/ })).toBeNull();
  });

  it("saves from a dialog and shows the new block straight away, without leaving the page", async () => {
    const answers = [
      calendarFixture({ venues: [venueFixture({ periods: [openPeriod()] })] }),
      calendarFixture({ venues: [venueFixture({ periods: [blockAfter] })] }),
    ];
    const fetchMock = vi.fn(async () => jsonReply(200, answers.shift() ?? answers[0]));
    vi.stubGlobal("fetch", fetchMock);
    post.mockResolvedValue({ ok: true, data: { affectedBookings: 0 } });
    render(<VenueCalendar canMarkUnavailable />);
    await screen.findByText("Available");

    fireEvent.click(screen.getByRole("button", { name: "Mark Orchid Hall unavailable" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Start date"), { target: { value: "2026-11-14" } });
    fireEvent.change(within(dialog).getByLabelText("Start time"), { target: { value: "09:00" } });
    fireEvent.change(within(dialog).getByLabelText("End date"), { target: { value: "2026-11-14" } });
    fireEvent.change(within(dialog).getByLabelText("End time"), { target: { value: "11:00" } });
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "maintenance" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save unavailable period" }));

    await waitFor(() => expect(screen.getByText("Blocked")).toBeTruthy());
    expect(post).toHaveBeenCalledWith("orchid", expect.objectContaining({ startDate: "2026-11-14", endTime: "11:00", reason: "maintenance" }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the dialog open and the calendar as it was when the save fails", async () => {
    const fetchMock = vi.fn(async () => jsonReply(200, calendarFixture({ venues: [venueFixture({ periods: [openPeriod()] })] })));
    vi.stubGlobal("fetch", fetchMock);
    post.mockResolvedValue({ ok: false, data: { error: "Not allowed" } });
    render(<VenueCalendar canMarkUnavailable />);
    await screen.findByText("Available");
    fireEvent.click(screen.getByRole("button", { name: "Mark Orchid Hall unavailable" }));
    const dialog = await screen.findByRole("dialog");
    for (const [label, value] of [["Start date", "2026-11-14"], ["Start time", "09:00"], ["End date", "2026-11-14"], ["End time", "11:00"]]) {
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    }
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "maintenance" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save unavailable period" }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// Added after the independent review
describe("SCRUM-130/AC3 review gaps", () => {
  beforeEach(() => post.mockReset());
  afterEach(() => vi.unstubAllGlobals());

  const fill = (dialog: HTMLElement) => {
    for (const [label, value] of [["Start date", "2026-11-14"], ["Start time", "09:00"], ["End date", "2026-11-14"], ["End time", "11:00"]]) {
      fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    }
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "maintenance" } });
  };

  it("reloads the same dates the organiser had chosen, not the current week", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => { urls.push(url); return jsonReply(200, calendarFixture({ venues: [venueFixture({ periods: [openPeriod()] })] })); });
    vi.stubGlobal("fetch", fetchMock);
    post.mockResolvedValue({ ok: true, data: { affectedBookings: 0 } });
    render(<VenueCalendar canMarkUnavailable />);
    await screen.findByText("Available");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-11-16" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-11-22" } });
    fireEvent.click(screen.getByRole("button", { name: "Show calendar" }));
    await waitFor(() => expect(urls).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Mark Orchid Hall unavailable" }));
    fill(await screen.findByRole("dialog"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save unavailable period" }));

    await waitFor(() => expect(urls).toHaveLength(3));
    expect(urls[2]).toBe(urls[1]);
    expect(urls[2]).toContain("from=2026-11-16");
    expect(urls[2]).toContain("to=2026-11-22");
  });

  it("shows why a save failed, keeps what was typed, and leaves the calendar unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture({ venues: [venueFixture({ periods: [openPeriod()] })] }))));
    post.mockResolvedValue({ ok: false, data: { error: "Only venue staff can mark a venue unavailable." } });
    render(<VenueCalendar canMarkUnavailable />);
    await screen.findByText("Available");
    fireEvent.click(screen.getByRole("button", { name: "Mark Orchid Hall unavailable" }));
    const dialog = await screen.findByRole("dialog");
    fill(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save unavailable period" }));

    expect((await within(dialog).findByRole("alert")).textContent).toContain("Only venue staff can mark a venue unavailable.");
    expect((within(dialog).getByLabelText("End time") as HTMLInputElement).value).toBe("11:00");
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("posts to the venue whose button was clicked, and names it in the dialog", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture())));
    post.mockResolvedValue({ ok: true, data: { affectedBookings: 0 } });
    render(<VenueCalendar canMarkUnavailable />);
    await screen.findByText("Jasmine Room");
    fireEvent.click(screen.getByRole("button", { name: "Mark Jasmine Room unavailable" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Mark Jasmine Room unavailable")).toBeTruthy();
    fill(dialog);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save unavailable period" }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe("jasmine");
  });
});
