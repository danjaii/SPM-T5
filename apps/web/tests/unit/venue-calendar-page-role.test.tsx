// SCRUM-130/AC3: only Venue Staff are given the Mark unavailable action on the venue calendar page

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const role = vi.hoisted(() => vi.fn());
vi.mock("@/lib/currentRoleServer", () => ({ getCurrentRole: role }));
const calendar = vi.hoisted(() => vi.fn());
vi.mock("@/components/venue-calendar/VenueCalendar", () => ({ VenueCalendar: (props: unknown) => { calendar(props); return <div />; } }));

import { VenueCalendarForRole } from "@/components/venue-calendar/VenueCalendarForRole";

beforeEach(() => { role.mockReset(); calendar.mockReset(); });

describe("SCRUM-130/AC3 the calendar gives Mark unavailable to Venue Staff only", () => {
  it.each([
    ["venue_staff", true],
    ["event_coordinator", false],
    ["technical_support_staff", false],
    [undefined, false],
  ])("for %s the action is %s", async (r, expected) => {
    role.mockResolvedValue(r);
    render(await VenueCalendarForRole());
    expect((calendar.mock.calls[0][0] as { canMarkUnavailable: boolean }).canMarkUnavailable).toBe(expected);
  });
});
