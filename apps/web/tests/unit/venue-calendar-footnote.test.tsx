// SCRUM-130 (Figma 09): the calendar explains its dashed setup and turnaround rows

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import { VenueCalendar } from "@/components/venue-calendar/VenueCalendar";
import { calendarFixture, jsonReply } from "./venue-calendar-fixtures";

afterEach(() => vi.unstubAllGlobals());

describe("SCRUM-130/AC1 setup and turnaround are explained", () => {
  it("SCRUM-130/AC1 says what the dashed rows are and that they count as occupied when checking conflicts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonReply(200, calendarFixture())));
    render(<VenueCalendar />);

    const note = await screen.findByText(/dashed rows/i);
    expect(note.textContent).toMatch(/setup and turnaround/i);
    expect(note.textContent).toMatch(/occupied when checking conflicts/i);
  });
});
