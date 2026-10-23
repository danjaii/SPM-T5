// SCRUM-52/AC1: the organiser's My event requests page, its nav entry and its dashboard link

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMyEventRequests } = vi.hoisted(() => ({ getMyEventRequests: vi.fn() }));
vi.mock("@/lib/myEventRequestsServer", () => ({ getMyEventRequests }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

import MyEventRequestsPage from "@/app/my-event-requests/page";
import { DashboardView } from "@/components/DashboardView";
import { NAV_ITEMS } from "@/lib/nav";

const REQUEST = {
  id: "evt-1",
  name: "Tech Summit",
  status: "under_review",
  preferred_start_datetime: "2026-11-20T01:00:00Z", // 9:00 am in Singapore
  expected_attendance: 250,
  submitted_at: "2026-10-01T02:00:00Z",
};

const renderPage = async () => render(await MyEventRequestsPage());

describe("SCRUM-52/AC1 My event requests page", () => {
  beforeEach(() => getMyEventRequests.mockReset());

  it("SCRUM-52/AC1 lists each request with its name, current status, start, attendance and submitted date", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [REQUEST] });

    await renderPage();

    expect(screen.getByRole("heading", { name: "My event requests" })).toBeTruthy();
    const row = screen.getByRole("row", { name: /Tech Summit/ });
    expect(within(row).getByText("Under Review")).toBeTruthy();
    expect(within(row).getByText("250")).toBeTruthy();
    expect(row.textContent).toMatch(/20 Nov 2026/);
    expect(row.textContent).toMatch(/1 Oct 2026/);
  });

  it("SCRUM-52/AC1 links each request to its page", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [REQUEST, { ...REQUEST, id: "evt-2", name: "Career Fair" }] });

    await renderPage();

    expect(screen.getByRole("link", { name: "Tech Summit" }).getAttribute("href")).toBe("/events/evt-1");
    expect(screen.getByRole("link", { name: "Career Fair" }).getAttribute("href")).toBe("/events/evt-2");
  });

  it("SCRUM-52/AC1 shows every request it is given, in the order given (newest first from event-service)", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...REQUEST, id: `evt-${i}`, name: `Event ${i}` }));
    getMyEventRequests.mockResolvedValue({ requests: many });

    await renderPage();

    const names = screen.getAllByRole("link").map((a) => a.textContent).filter((t) => t?.startsWith("Event "));
    expect(names).toHaveLength(60);
    expect(names[0]).toBe("Event 0");
    expect(names[59]).toBe("Event 59");
  });

  it("SCRUM-52/AC1 shows a dash for a draft with no start, attendance or submitted date", async () => {
    getMyEventRequests.mockResolvedValue({
      requests: [{ id: "evt-9", name: "Half done", status: "draft", preferred_start_datetime: null, expected_attendance: null, submitted_at: null }],
    });

    await renderPage();

    const row = screen.getByRole("row", { name: /Half done/ });
    expect(within(row).getByText("Draft")).toBeTruthy();
    expect(within(row).getAllByText("—")).toHaveLength(3);
  });

  it("SCRUM-52/AC1 tells an organiser with no requests so", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [] });

    await renderPage();

    expect(screen.getByText("You have not created any event requests yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("SCRUM-52/AC1 shows event-service's message, not an empty list, when it cannot load or refuses", async () => {
    getMyEventRequests.mockResolvedValue({ error: "You are not allowed to view event requests created by organisers." });

    await renderPage();

    expect(screen.getByRole("alert").textContent).toBe("You are not allowed to view event requests created by organisers.");
    expect(screen.queryByText("You have not created any event requests yet.")).toBeNull();
  });

  it("SCRUM-52/AC1 links back to the dashboard", async () => {
    getMyEventRequests.mockResolvedValue({ requests: [] });

    await renderPage();

    expect(screen.getByRole("link", { name: "← Back to dashboard" }).getAttribute("href")).toBe("/dashboard");
  });
});

describe("SCRUM-52/AC1 reaching the page", () => {
  it("SCRUM-52/AC1 gives the Event Organiser a My event requests nav item, and no other role", () => {
    const entry = NAV_ITEMS.event_organiser.find((i) => i.label === "My event requests");
    expect(entry?.href).toBe("/my-event-requests");
    for (const [role, items] of Object.entries(NAV_ITEMS)) {
      if (role !== "event_organiser") expect(items.map((i) => i.href)).not.toContain("/my-event-requests");
    }
  });

  it("SCRUM-52/AC1 links the organiser's dashboard to the page, and no other role's", () => {
    const dashboardFor = (role: string) => ({ user: { fullName: "Jason Chua", email: "j@example.com", role }, sections: [] });

    const { unmount } = render(<DashboardView data={dashboardFor("event_organiser")} />);
    expect(screen.getByRole("link", { name: "My event requests" }).getAttribute("href")).toBe("/my-event-requests");
    unmount();

    render(<DashboardView data={dashboardFor("event_coordinator")} />);
    expect(screen.queryByRole("link", { name: "My event requests" })).toBeNull();
  });
});
