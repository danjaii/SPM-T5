import { render, screen, within } from "@testing-library/react";
import type { NotificationItem } from "@spm-t5/shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

const { getTechnicalSupportDashboard, getShellData } = vi.hoisted(() => ({ getTechnicalSupportDashboard: vi.fn(), getShellData: vi.fn() }));
vi.mock("@/lib/technicalSupportDashboardServer", () => ({ getTechnicalSupportDashboard }));
vi.mock("@/lib/shellServer", () => ({ getShellData }));

import TechnicalSupportStaffDashboard from "@/app/dashboard/technical_support_staff/page";
import type { InventoryItemView } from "@/lib/equipmentInventory";
import type { EquipmentQueueItemView } from "@/lib/equipmentRequests";
import { newAssignments, outOfService, technicalSupportKpis } from "@/lib/technicalSupportDashboard";

const request = (over: Partial<EquipmentQueueItemView> = {}): EquipmentQueueItemView => ({
  id: "r1", eventId: "e1", eventName: "Tech Summit", eventDate: "2026-11-14", venueName: "Hall A", equipment: "Projector", quantity: 2,
  status: "SUBMITTED", statusLabel: "Submitted", updated: false, ...over,
});
const item = (over: Partial<InventoryItemView> = {}): InventoryItemView => ({
  id: "i1", name: "Livestream kit", type: null, total: 2, available: 0, heldBy: [], outOfService: null, ...over,
});
const assignment = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: "n1", type: "technical_assignment_assigned", title: "New on-site assignment", message: "Tech Summit, Hall A", isRead: false,
  createdAt: "2026-10-30T00:00:00Z", readAt: null, related: null, actionRequired: true,
  acknowledgement: { canAcknowledge: true, acknowledgedAt: null }, ...over,
});

async function renderPage(data: object) {
  getTechnicalSupportDashboard.mockResolvedValue(data);
  getShellData.mockResolvedValue({ user: { fullName: "Aisha Rahman", role: "technical_support_staff" }, counts: {} });
  render(await TechnicalSupportStaffDashboard());
}

describe("SCRUM-164/AC1 equipment requests waiting", () => {
  it("SCRUM-164/AC1 counts the requests waiting and links to the review queue", async () => {
    await renderPage({ requests: [request(), request({ id: "r2", updated: true })], items: [], notifications: [] });
    const kpi = within(screen.getByRole("list", { name: "Queue summary" }));
    expect(kpi.getByText("Requests to review")).toBeTruthy();
    expect(kpi.getByText("2")).toBeTruthy();
    expect(kpi.getByText("1 updated by the coordinator")).toBeTruthy();
    expect(screen.getByRole("link", { name: /View all 2 requests/ }).getAttribute("href")).toBe("/equipment-requests");
    expect(screen.getByRole("link", { name: "Open requests" }).getAttribute("href")).toBe("/equipment-requests");
  });

  it("SCRUM-164/AC1 marks an updated request with an icon and label", async () => {
    await renderPage({ requests: [request({ updated: true })], items: [], notifications: [] });
    const badge = screen.getByText("Updated");
    expect(badge.querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Tech Summit/ }).getAttribute("href")).toBe("/equipment-requests/r1");
  });

  it("SCRUM-164/AC1 says Unavailable, not 0, when the requests could not be loaded", async () => {
    await renderPage({ requests: undefined, items: [], notifications: [] });
    expect(screen.queryByText("Requests to review")).toBeNull();
    expect(screen.getAllByText("Unavailable").length).toBe(1);
  });
});

describe("SCRUM-164/AC2 items out of service", () => {
  it("SCRUM-164/AC2 lists them with the reason as an icon and a label", async () => {
    await renderPage({ requests: [], items: [item({ outOfService: "damaged" }), item({ id: "i2", name: "Mic", outOfService: null })], notifications: [] });
    const section = within(screen.getByRole("region", { name: "Out of service" }));
    expect(section.getByText("Livestream kit")).toBeTruthy();
    expect(section.queryByText("Mic")).toBeNull();
    expect(section.getByText("Damaged").querySelector("svg")).toBeTruthy();
  });

  it("SCRUM-164/AC2 says everything works when nothing is out of service", async () => {
    await renderPage({ requests: [], items: [item()], notifications: [] });
    expect(screen.getByText("Everything in the catalogue is working.")).toBeTruthy();
    expect(outOfService([item()])).toEqual([]);
  });
});

describe("SCRUM-164/AC3 new on-site assignments", () => {
  it("SCRUM-164/AC3 shows unacknowledged assigned and changed notifications under Needs your action", async () => {
    await renderPage({
      requests: [], items: [],
      notifications: [
        assignment(),
        assignment({ id: "n2", type: "technical_assignment_changed", title: "On-site assignment changed" }),
        assignment({ id: "n3", title: "Already done", acknowledgement: { canAcknowledge: false, acknowledgedAt: "2026-10-31T00:00:00Z" } }),
        assignment({ id: "n4", type: "technical_assignment_cancelled", title: "Cancelled", acknowledgement: undefined }),
        assignment({ id: "n5", type: "event_approved", title: "Something else", acknowledgement: undefined }),
      ],
    });
    const section = within(screen.getByRole("region", { name: "Needs your action" }));
    expect(section.getByText("New on-site assignment")).toBeTruthy();
    expect(section.getByText("On-site assignment changed")).toBeTruthy();
    expect(section.queryByText("Already done")).toBeNull();
    expect(section.queryByText("Cancelled")).toBeNull();
    expect(section.queryByText("Something else")).toBeNull();
  });

  it("SCRUM-164/AC3 says they are caught up when there are none", async () => {
    await renderPage({ requests: [], items: [], notifications: [] });
    expect(screen.getByText(/No new on-site assignments/)).toBeTruthy();
  });

  it("SCRUM-164/AC3 says Unavailable, not caught up, when notifications could not be loaded", async () => {
    await renderPage({ requests: [], items: [], notifications: undefined });
    expect(screen.queryByText(/No new on-site assignments/)).toBeNull();
    expect(within(screen.getByRole("region", { name: "Needs your action" })).getByText("Unavailable")).toBeTruthy();
  });

  it("SCRUM-164/AC3 greets the signed-in person by first name", async () => {
    await renderPage({ requests: [], items: [], notifications: [] });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome, Aisha");
  });
});

describe("SCRUM-164 figures", () => {
  it("leaves out a figure whose source failed and warns about out-of-service items", () => {
    expect(technicalSupportKpis(undefined, undefined, undefined)).toEqual([]);
    const [, out] = technicalSupportKpis([], [item({ outOfService: "retired" })], []);
    expect(out).toMatchObject({ label: "Out of service", value: 1, warn: true });
  });

  it("only counts assignments the technician can still acknowledge", () => {
    expect(newAssignments([assignment(), assignment({ acknowledgement: { canAcknowledge: true, acknowledgedAt: "x" } })])).toHaveLength(1);
  });
});

describe("SCRUM-164 edge cases", () => {
  it("SCRUM-164/AC3 greets without a name when nobody's shell data loads, and points to the rest past five assignments", async () => {
    getTechnicalSupportDashboard.mockResolvedValue({ requests: [request()], items: [], notifications: Array.from({ length: 6 }, (_, i) => assignment({ id: `n${i}`, title: `Assignment ${i}` })) });
    getShellData.mockResolvedValue(null);
    render(await TechnicalSupportStaffDashboard());
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Welcome");
    expect(screen.getByText(/Showing 5 of 6/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /View all 1 request$/ })).toBeTruthy();
  });

  it("SCRUM-164/AC1 shows an empty queue as nothing waiting", async () => {
    await renderPage({ requests: [], items: [], notifications: [] });
    expect(screen.getByText("No requests waiting for action.")).toBeTruthy();
  });

  it("SCRUM-164/AC2 says Unavailable when the inventory could not be loaded", async () => {
    await renderPage({ requests: [], items: undefined, notifications: [] });
    expect(within(screen.getByRole("region", { name: "Out of service" })).getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("Out of service", { selector: "p" })).toBeNull();
  });
});
