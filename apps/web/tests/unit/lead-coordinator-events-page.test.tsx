import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Pretend loading helpers, so this test is only about the page itself
const { getCoordinatorEvents, getLeadCoordinators } = vi.hoisted(() => ({ getCoordinatorEvents: vi.fn(), getLeadCoordinators: vi.fn() }));
vi.mock("@/lib/leadServer", () => ({ getCoordinatorEvents, getLeadCoordinators }));

import CoordinatorEventsPage from "@/app/lead/coordinators/[id]/page";

const open = async () => render(await CoordinatorEventsPage({ params: Promise.resolve({ id: "c-1" }) }));
const event = {
  id: "evt-1",
  name: "Tech Summit",
  status: "confirmed",
  preferred_start_datetime: "2031-06-15T01:00:00Z",
  preferred_end_datetime: "2031-06-15T09:00:00Z",
  expected_attendance: 120,
};

describe("SCRUM-167 coordinator's active events page", () => {
  it("SCRUM-167/AC1 uses the shared page frame, with the coordinator's name in the title and a subtitle", async () => {
    getLeadCoordinators.mockResolvedValue({ coordinators: [{ id: "c-1", full_name: "Marcus Lim", workload: 1 }] });
    getCoordinatorEvents.mockResolvedValue({ events: [event] });

    const { container } = await open().then(() => ({ container: document.body }));

    expect(screen.getByRole("heading", { level: 1, name: "Marcus Lim's active events" })).toBeTruthy();
    expect(screen.getByText(/Open one to reassign it/)).toBeTruthy();
    expect(container.querySelector(".dash__main")).toBeNull();
  });

  it("SCRUM-167/AC2, AC3 shows the events table with a status icon and label, and each name opens its reassign step", async () => {
    getLeadCoordinators.mockResolvedValue({ coordinators: [{ id: "c-1", full_name: "Marcus Lim", workload: 1 }] });
    getCoordinatorEvents.mockResolvedValue({ events: [event] });

    await open();

    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Event", "Status", "Preferred date and time", "Expected attendance"]);
    const row = screen.getByRole("row", { name: /Tech Summit/ });
    expect(within(row).getByText("Confirmed")).toBeTruthy();
    expect(within(row).getByTestId("status-icon")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reassign Tech Summit" }).getAttribute("href")).toBe("/lead/events/evt-1/reassign");
  });

  it("SCRUM-167/AC4 shows an empty state with an icon when there are no active events", async () => {
    getLeadCoordinators.mockResolvedValue({ coordinators: [] });
    getCoordinatorEvents.mockResolvedValue({ events: [] });

    await open();

    const message = screen.getByText("This coordinator has no active events.");
    expect(message.parentElement!.querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("SCRUM-167/AC5 shows the load error in the standard error box and no table", async () => {
    getLeadCoordinators.mockResolvedValue({ coordinators: [] });
    getCoordinatorEvents.mockResolvedValue({ error: "We couldn't load this coordinator's events." });

    await open();

    expect(screen.getByRole("alert").textContent).toBe("We couldn't load this coordinator's events.");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("SCRUM-167/AC6 links back to the coordinator overview", async () => {
    getLeadCoordinators.mockResolvedValue({ coordinators: [] });
    getCoordinatorEvents.mockResolvedValue({ events: [] });

    await open();

    expect(screen.getByRole("link", { name: "Back to coordinator overview" }).getAttribute("href")).toBe("/lead/coordinators");
  });

  it("SCRUM-167/AC7 keeps the table in its own horizontally scrolling box", async () => {
    getLeadCoordinators.mockResolvedValue({ coordinators: [] });
    getCoordinatorEvents.mockResolvedValue({ events: [event] });

    await open();

    expect(screen.getByRole("table").closest(".overflow-x-auto")).toBeTruthy();
  });
});
