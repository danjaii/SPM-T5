import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { getMyRegistrations, getUpcomingEvents, getShellData } = vi.hoisted(() => ({
  getMyRegistrations: vi.fn(),
  getUpcomingEvents: vi.fn(),
  getShellData: vi.fn(),
}));
vi.mock("@/lib/eventRegistrationServer", () => ({ getMyRegistrations }));
vi.mock("@/lib/getUpcomingEvents", () => ({ getUpcomingEvents }));
vi.mock("@/lib/shellServer", () => ({ getShellData }));

import AttendeeHome from "@/app/dashboard/attendee/page";
import { splitRegistrations } from "@/lib/attendeeDashboard";
import type { MyRegistration } from "@/lib/eventRegistration";

const reg = (id: string, name: string, status: MyRegistration["status"], start: string): MyRegistration => ({
  id,
  status,
  registered_at: "2026-10-01T00:00:00Z",
  can_withdraw: false,
  event: { id: `e-${id}`, name, start_at: start, end_at: null, venue: { name: "Main Auditorium", address: null } },
});

const load = (registrations: MyRegistration[] | { error: string }) => {
  getMyRegistrations.mockResolvedValue(Array.isArray(registrations) ? { registrations } : registrations);
  getUpcomingEvents.mockResolvedValue({ events: [] });
  getShellData.mockResolvedValue({ user: { fullName: "Amir Wong", role: "attendee" }, counts: {} });
};

describe("SCRUM-161 attendee Home", () => {
  // AC1: registrations by status, in the attendee's words, with icon + label
  it("SCRUM-161/AC1 shows each registration's status in the attendee's words with an icon", async () => {
    load([
      reg("1", "Tech Summit", "confirmed", "2026-12-01T01:00:00Z"),
      reg("2", "Hackathon", "pending", "2026-12-02T01:00:00Z"),
      reg("3", "Film Night", "withdrawn", "2026-12-03T01:00:00Z"),
    ]);
    render(await AttendeeHome());
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back, Amir" })).toBeTruthy();
    const rows = screen.getAllByRole("listitem").filter((li) => li.querySelector("[data-testid=status-icon]"));
    const text = rows.map((r) => r.textContent);
    expect(text.some((t) => t?.includes("Tech Summit") && t.includes("Registered"))).toBe(true);
    expect(text.some((t) => t?.includes("Hackathon") && t.includes("Waitlisted"))).toBe(true);
    expect(text.some((t) => t?.includes("Film Night") && t.includes("Withdrawn"))).toBe(true);
    expect(screen.queryByText("Pending")).toBeNull();
    for (const r of rows) expect(within(r).getAllByTestId("status-icon").length).toBeGreaterThan(0);
  });

  // AC2: the soonest upcoming event is first under Upcoming
  it("SCRUM-161/AC2 lists the soonest event first, whatever order they arrive in", () => {
    const { upcoming } = splitRegistrations([
      reg("1", "Later", "confirmed", "2026-12-20T01:00:00Z"),
      reg("2", "Sooner", "pending", "2026-12-02T01:00:00Z"),
      reg("3", "Gone", "withdrawn", "2026-12-01T01:00:00Z"),
    ]);
    expect(upcoming.map((r) => r.event.name)).toEqual(["Sooner", "Later"]);
  });

  it("SCRUM-161/AC2 shows the Upcoming heading above the withdrawn ones", async () => {
    load([reg("1", "Gone", "withdrawn", "2026-12-01T01:00:00Z"), reg("2", "Soon", "confirmed", "2026-12-02T01:00:00Z")]);
    render(await AttendeeHome());
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Upcoming", "Withdrawn or declined"]);
  });

  // AC3: no registrations: an empty state that links to the List of events
  it("SCRUM-161/AC3 shows an empty state linking to Browse events when there are none", async () => {
    load([]);
    render(await AttendeeHome());
    expect(screen.getByText("You have not registered for any events yet.")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: "Browse events" });
    expect(links.every((l) => l.getAttribute("href") === "/dashboard/attendee/browse")).toBe(true);
  });

  it("SCRUM-161/AC3 says registrations could not be loaded rather than showing the empty state", async () => {
    load({ error: "nope" });
    render(await AttendeeHome());
    expect(screen.getByText("Your registrations could not be loaded.", { selector: "p.flex" })).toBeTruthy();
    expect(screen.queryByText("You have not registered for any events yet.")).toBeNull();
  });
});
