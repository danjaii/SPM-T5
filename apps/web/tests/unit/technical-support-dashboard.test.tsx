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
import { greeting, homeSummary, newAssignments, requestRows, shortDate, shortages, technicalSupportKpis } from "@/lib/technicalSupportDashboard";

const request = (over: Partial<EquipmentQueueItemView> = {}): EquipmentQueueItemView => ({
  id: "r1", eventId: "e1", eventName: "Tech Summit", eventDate: "2026-11-14", venueName: "Hall A", equipment: "Projector", quantity: 2,
  status: "SUBMITTED", statusLabel: "Submitted", updated: false, ...over,
});
const item = (over: Partial<InventoryItemView> = {}): InventoryItemView => ({
  id: "i1", name: "Projector", type: null, total: 12, available: 4, heldBy: [], outOfService: null, ...over,
});
const assignment = (over: Partial<NotificationItem> = {}): NotificationItem => ({
  id: "n1", type: "technical_assignment_assigned", title: "New on-site assignment", message: "Tech Summit, Hall A", isRead: false,
  createdAt: "2026-10-30T00:00:00Z", readAt: null, related: null, actionRequired: true,
  acknowledgement: { canAcknowledge: true, acknowledgedAt: null }, ...over,
});

async function renderPage(data: object, shell: object | null = { user: { fullName: "Aisha Rahman", role: "technical_support_staff" }, counts: {} }) {
  getTechnicalSupportDashboard.mockResolvedValue(data);
  getShellData.mockResolvedValue(shell);
  render(await TechnicalSupportStaffDashboard());
}

describe("SCRUM-164/AC1 equipment requests waiting", () => {
  it("SCRUM-164/AC1 counts the requests waiting, linking the count and the page button to the review queue", async () => {
    await renderPage({ requests: [request(), request({ id: "r2" })], items: [item()], notifications: [] });
    expect(screen.getByRole("link", { name: "2 equipment requests, open the review queue" }).getAttribute("href")).toBe("/equipment-requests");
    expect(screen.getByRole("link", { name: "Open requests" }).getAttribute("href")).toBe("/equipment-requests");
    expect(within(screen.getByRole("list", { name: "Queue summary" })).getByText("New requests")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening), Aisha$/);
    expect(screen.getByText("2 requests need a reservation. 0 items are short.")).toBeTruthy();
  });

  it("SCRUM-164/AC1 gives each request its availability as an icon and a label, and an action that opens it", async () => {
    await renderPage({
      requests: [
        request({ id: "a", eventName: "Pitch Day", equipment: "Livestream kit", quantity: 1 }),
        request({ id: "b", eventName: "Networking", equipment: "Microphones", quantity: 8 }),
        request({ id: "c", eventName: "Summit", equipment: "Projector", quantity: 2 }),
      ],
      items: [item({ id: "x", name: "Livestream kit", total: 2, available: 0 }), item({ id: "y", name: "Microphones", total: 20, available: 6 }), item()],
      notifications: [],
    });
    for (const label of ["Unavailable", "Partial", "Available"]) expect(screen.getByText(label).querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Reply to coordinator: Pitch Day/ }).getAttribute("href")).toBe("/equipment-requests/a");
    expect(screen.getByRole("link", { name: /^Reserve: Networking/ }).getAttribute("href")).toBe("/equipment-requests/b");
    expect(screen.getByRole("link", { name: /^Reserve: Summit/ }).getAttribute("href")).toBe("/equipment-requests/c");
    expect(screen.getByText("Needs 1 · none free on 14 Nov")).toBeTruthy();
    expect(screen.getByText("Needs 8 · 6 free on 14 Nov")).toBeTruthy();
    expect(screen.getByText(/2 items are short/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Livestream kit, Microphones/ }).getAttribute("href")).toBe("/equipment-inventory");
  });

  it("SCRUM-164/AC1 matches a typed item by the label the queue shows, and draws a border on the Reserve button", async () => {
    await renderPage({
      requests: [request({ equipment: "Audio: Microphones", quantity: 2 })],
      items: [item({ name: "Microphones", type: "Audio", total: 20, available: 6 })],
      notifications: [],
    });
    expect(screen.getByText("Available").querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Reserve: Tech Summit/ }).className).toContain("border-input");
  });

  it("SCRUM-164/AC1 reviews a request whose item is not in the inventory", async () => {
    await renderPage({ requests: [request({ equipment: "Lectern" })], items: [item()], notifications: [] });
    expect(screen.getByRole("link", { name: /^Review: Tech Summit/ })).toBeTruthy();
    expect(screen.getByText("Hall A · 14 Nov")).toBeTruthy();
  });

  it("SCRUM-164/AC1 says nothing is waiting for an empty queue", async () => {
    await renderPage({ requests: [], items: [item()], notifications: [] });
    expect(screen.getByText("No requests waiting for action.")).toBeTruthy();
  });

  it("SCRUM-164/AC1 says Unavailable, not 0, and leaves the figures out when requests could not be loaded", async () => {
    await renderPage({ requests: undefined, items: [item()], notifications: [] });
    expect(within(screen.getByRole("region", { name: "Equipment requests" })).getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("New requests")).toBeNull();
    expect(screen.getByText("Some figures could not be loaded.")).toBeTruthy();
  });
});

describe("SCRUM-164/AC2 items out of service", () => {
  it("SCRUM-164/AC2 shows an item's out-of-service reason as an icon and a label in the stock list", async () => {
    await renderPage({ requests: [], items: [item({ name: "Livestream kit", available: 0, total: 2, outOfService: "damaged" }), item({ id: "i2", name: "Tables", total: 60, available: 40 })], notifications: [] });
    const stock = within(screen.getByRole("region", { name: "Stock today" }));
    expect(stock.getByText("Damaged").closest("span")?.querySelector("svg")).toBeTruthy();
    expect(stock.getByText("40 of 60 free")).toBeTruthy();
    expect(stock.getAllByRole("progressbar")).toHaveLength(2);
  });

  it("SCRUM-164/AC2 colours the stock bar red when none are free, amber under a third, otherwise the brand colour", async () => {
    await renderPage({
      requests: [],
      items: [item({ id: "1", name: "None", total: 2, available: 0 }), item({ id: "2", name: "Few", total: 20, available: 6 }), item({ id: "3", name: "Plenty", total: 12, available: 4 }), item({ id: "4", name: "Empty", total: 0, available: 0 })],
      notifications: [],
    });
    const fills = screen.getAllByRole("progressbar").map((bar) => bar.innerHTML);
    expect(fills[0]).toContain("bg-status-danger-fg");
    expect(fills[1]).toContain("bg-status-warning-fg");
    expect(fills[2]).toContain("bg-primary");
  });

  it("SCRUM-164/AC2 says the catalogue is empty when it has no equipment", async () => {
    await renderPage({ requests: [], items: [], notifications: [] });
    expect(screen.getByText("The catalogue has no equipment yet.")).toBeTruthy();
  });

  it("SCRUM-164/AC2 says Unavailable when the inventory could not be loaded", async () => {
    await renderPage({ requests: [request()], items: undefined, notifications: [] });
    expect(within(screen.getByRole("region", { name: "Stock today" })).getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("Shortages")).toBeNull();
  });
});

describe("SCRUM-164/AC3 new on-site assignments", () => {
  it("SCRUM-164/AC3 counts only assignments the technician can still acknowledge", () => {
    const list = [
      assignment(),
      assignment({ id: "n2", type: "technical_assignment_changed" }),
      assignment({ id: "n3", acknowledgement: { canAcknowledge: false, acknowledgedAt: "2026-10-31T00:00:00Z" } }),
      assignment({ id: "n4", type: "technical_assignment_cancelled", acknowledgement: undefined }),
      assignment({ id: "n5", type: "event_approved", acknowledgement: undefined }),
      assignment({ id: "n6", acknowledgement: { canAcknowledge: true, acknowledgedAt: "x" } }),
    ];
    expect(newAssignments(list).map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("SCRUM-164/AC3 shows them in the On-site next figure, naming the first", async () => {
    await renderPage({ requests: [], items: [], notifications: [assignment({ related: { kind: "venue_booking", id: "b", label: "Annual Tech Summit", href: null } })] });
    expect(screen.getByText("On-site next")).toBeTruthy();
    expect(screen.getByText("Annual Tech Summit")).toBeTruthy();
  });
});

describe("SCRUM-164 figures and wording", () => {
  it("fills the four figures, and leaves out one whose source failed", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    const requests = [request({ eventDate: "2026-11-12" }), request({ id: "r2", eventDate: "2026-12-20" })];
    const items = [item({ heldBy: [{ eventName: "Robotics", units: 2 }, { eventName: "Film", units: 1 }] })];
    expect(technicalSupportKpis(requests, items, [assignment()], [], now).map((k) => [k.label, k.value, k.note])).toEqual([
      ["New requests", 2, "1 is for this week"],
      ["Shortages", 0, "Nothing is short"],
      ["Reserved today", 3, "Held by 2 events"],
      ["On-site next", 1, "New on-site assignment"],
    ]);
    expect(technicalSupportKpis(undefined, undefined, undefined, [])).toEqual([]);
    expect(technicalSupportKpis([request({ eventDate: "2026-11-10" })], [item({ heldBy: [{ eventName: "Solo", units: 1 }] })], [], ["Projector"], now).map((k) => k.note)).toEqual([
      "1 is for this week", "Projector", "Held by 1 event", "No new assignments",
    ]);
  });

  it("words the summary, greeting, dates and shortages", () => {
    expect(homeSummary([request()], ["Projector"])).toBe("1 request needs a reservation. 1 item is short.");
    expect(greeting(new Date("2026-11-10T00:00:00Z"))).toBe("Good morning");
    expect(greeting(new Date("2026-11-10T06:00:00Z"))).toBe("Good afternoon");
    expect(greeting(new Date("2026-11-10T12:00:00Z"))).toBe("Good evening");
    expect(shortDate("2026-12-05")).toBe("5 Dec");
    expect(shortages(requestRows([request({ quantity: 9 })], [item()]))).toEqual(["Projector"]);
  });

  it("greets without a name when the shell data does not load, and shows at most five requests", async () => {
    await renderPage({ requests: Array.from({ length: 6 }, (_, i) => request({ id: `r${i}` })), items: [item()], notifications: [] }, null);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening)$/);
    expect(within(screen.getByRole("region", { name: "Equipment requests" })).getAllByRole("listitem")).toHaveLength(5);
  });
});
