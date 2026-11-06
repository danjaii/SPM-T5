// SCRUM-130/AC3: only Venue Staff are given Mark unavailable on the venue calendar page. SCRUM-130 (Figma 09): only an Event
// Coordinator is given New booking, with their events that can still take a venue request.

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const role = vi.hoisted(() => vi.fn());
vi.mock("@/lib/currentRoleServer", () => ({ getCurrentRole: role }));
const assigned = vi.hoisted(() => vi.fn());
vi.mock("@/lib/coordinatorDashboardServer", () => ({ getAssignedEvents: assigned }));
const calendar = vi.hoisted(() => vi.fn());
vi.mock("@/components/venue-calendar/VenueCalendar", () => ({ VenueCalendar: (props: unknown) => { calendar(props); return <div />; } }));

import { VenueCalendarForRole } from "@/components/venue-calendar/VenueCalendarForRole";

type Props = { canMarkUnavailable: boolean; bookableEvents?: { id: string; name: string }[] };
const props = () => calendar.mock.calls[0][0] as Props;

beforeEach(() => { role.mockReset(); assigned.mockReset(); calendar.mockReset(); });

describe("SCRUM-130/AC3 the calendar gives Mark unavailable to Venue Staff only", () => {
  it.each([
    ["venue_staff", true],
    ["event_coordinator", false],
    ["technical_support_staff", false],
    [undefined, false],
  ])("for %s the action is %s", async (r, expected) => {
    role.mockResolvedValue(r);
    assigned.mockResolvedValue([]);
    render(await VenueCalendarForRole());
    expect(props().canMarkUnavailable).toBe(expected);
  });
});

describe("SCRUM-130 the calendar gives New booking to Event Coordinators only", () => {
  it("SCRUM-130 passes a coordinator only their events that can take a venue request", async () => {
    role.mockResolvedValue("event_coordinator");
    assigned.mockResolvedValue([
      { id: "e1", name: "Tech Summit", status: "approved" },
      { id: "e2", name: "Draft Fair", status: "submitted" },
      { id: "e3", name: "Planning Day", status: "planning" },
      { id: "e4", name: "Done Gala", status: "confirmed" },
    ]);
    render(await VenueCalendarForRole());
    expect(props().bookableEvents).toEqual([{ id: "e1", name: "Tech Summit" }, { id: "e3", name: "Planning Day" }]);
  });

  it("SCRUM-130 gives a coordinator an empty list when their events cannot be read", async () => {
    role.mockResolvedValue("event_coordinator");
    assigned.mockResolvedValue(undefined);
    render(await VenueCalendarForRole());
    expect(props().bookableEvents).toEqual([]);
  });

  it.each(["venue_staff", "technical_support_staff", undefined])("SCRUM-130 gives %s no New booking, and does not read events", async (r) => {
    role.mockResolvedValue(r);
    render(await VenueCalendarForRole());
    expect(props().bookableEvents).toBeUndefined();
    expect(assigned).not.toHaveBeenCalled();
  });
});
