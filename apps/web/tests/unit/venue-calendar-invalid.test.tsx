import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { calendarFixture, jsonReply } from "./venue-calendar-fixtures";

afterEach(() => vi.unstubAllGlobals());

async function openCalendar(answer: (url: string) => ReturnType<typeof jsonReply> = () => jsonReply(200, calendarFixture())) {
  const fetchMock = vi.fn(async (url: string) => answer(url));
  vi.stubGlobal("fetch", fetchMock);
  render(<VenueCalendar />);
  await screen.findByText("Orchid Hall");
  return fetchMock;
}
const choose = (from: string, to: string) => {
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("End date"), { target: { value: to } });
  fireEvent.click(screen.getByRole("button", { name: "Show calendar" }));
};

describe("SCRUM-84/AC6 reject an invalid date range", () => {
  it("SCRUM-84/AC6 does not apply an end date earlier than the start date: no request, old view kept, reason given", async () => {
    const fetchMock = await openCalendar();
    choose("2026-12-10", "2026-12-01");
    expect(await screen.findByText("The end date must be on or after the start date.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Orchid Hall")).toBeTruthy();
    expect(screen.getByText("Showing 2026-11-14")).toBeTruthy();
    expect(screen.getByLabelText("End date").getAttribute("aria-invalid")).toBe("true");
  });

  it("SCRUM-84/AC6 refuses a range of more than 62 days", async () => {
    const fetchMock = await openCalendar();
    choose("2026-01-01", "2026-12-31");
    expect(await screen.findByText("Choose a range of 62 days or fewer.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("SCRUM-84/AC6 asks for a start date when only an end date is given", async () => {
    await openCalendar();
    choose("", "2026-12-01");
    expect(await screen.findByText("Choose a start date.")).toBeTruthy();
    expect(screen.getByLabelText("Start date").getAttribute("aria-invalid")).toBe("true");
  });

  it("SCRUM-84/AC6 shows the service's own messages for a range it refuses, and keeps the old view", async () => {
    const fetchMock = await openCalendar((url) =>
      url.includes("from=") ? jsonReply(422, { code: "VALIDATION_FAILED", error: "Some fields are invalid.", fieldErrors: { to: "The end date must be on or after the start date." } }) : jsonReply(200, calendarFixture()),
    );
    choose("2026-12-01", "2026-12-03");
    expect(await screen.findByText("The end date must be on or after the start date.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Orchid Hall")).toBeTruthy();
  });

  it("SCRUM-84/AC6 clears the messages once a valid range is applied", async () => {
    await openCalendar();
    choose("2026-12-10", "2026-12-01");
    await screen.findByText("The end date must be on or after the start date.");
    choose("2026-12-01", "2026-12-10");
    await waitFor(() => expect(screen.queryByText("The end date must be on or after the start date.")).toBeNull());
  });

  it("SCRUM-84/AC6 leaves an empty form on the current week (nothing to validate)", async () => {
    const fetchMock = await openCalendar();
    fireEvent.click(screen.getByRole("button", { name: "Show calendar" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe("http://localhost:4003/venue-calendar");
  });
});
