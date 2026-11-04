// SCRUM-130/AC2: a block's reason appears on hover, on tap and on keyboard focus, not only as a native title

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VenueCalendarVenue } from "@/components/venue-calendar/VenueCalendarVenue";
import type { CalendarVenue } from "@/lib/venueCalendar";
import { venueFixture } from "./venue-calendar-fixtures";

const block = { kind: "block", status: "BLOCKED", label: "Blocked", start: "2026-11-14T07:00:00.000Z", end: "2026-11-14T09:00:00.000Z", reason: "maintenance", reason_label: "Maintenance" };
const open = { kind: "open", status: "AVAILABLE", label: "Available", start: "2026-11-14T00:00:00.000Z", end: "2026-11-14T07:00:00.000Z" };
const show = (periods: unknown[]) => render(<VenueCalendarVenue venue={venueFixture({ periods }) as unknown as CalendarVenue} />);
const hint = () => screen.getByRole("button", { name: /why is this blocked/i });

describe("SCRUM-130/AC2 the block's reason on hover, tap and keyboard focus", () => {
  it("SCRUM-130/AC2 shows nothing until asked, and has the hint only on a block", () => {
    show([open, block]);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getAllByRole("button", { name: /why is this blocked/i })).toHaveLength(1);
  });

  it("SCRUM-130/AC2 shows the reason on hover and hides it when the pointer leaves", () => {
    show([block]);
    fireEvent.mouseEnter(hint());
    expect(screen.getByRole("tooltip").textContent).toBe("Blocked: Maintenance");
    fireEvent.mouseLeave(hint());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("SCRUM-130/AC2 shows the reason on keyboard focus and hides it on blur", () => {
    show([block]);
    fireEvent.focus(hint());
    expect(screen.getByRole("tooltip").textContent).toBe("Blocked: Maintenance");
    expect(hint().getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.blur(hint());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("SCRUM-130/AC2 opens on tap and closes on a second tap or Escape", () => {
    show([block]);
    fireEvent.click(hint());
    expect(screen.getByRole("tooltip")).toBeTruthy();
    fireEvent.click(hint());
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.click(hint());
    fireEvent.keyDown(hint(), { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("SCRUM-130/AC2 says only the status when no reason was recorded", () => {
    show([{ ...block, reason: undefined, reason_label: undefined }]);
    fireEvent.focus(hint());
    expect(screen.getByRole("tooltip").textContent).toBe("Blocked");
  });
});
