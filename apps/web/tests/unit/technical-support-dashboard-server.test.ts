import { describe, expect, it, vi } from "vitest";

const { getEquipmentQueue, getEquipmentInventory, getNotifications } = vi.hoisted(() => ({
  getEquipmentQueue: vi.fn(),
  getEquipmentInventory: vi.fn(),
  getNotifications: vi.fn(),
}));
vi.mock("@/lib/equipmentRequestsServer", () => ({ getEquipmentQueue }));
vi.mock("@/lib/equipmentInventoryServer", () => ({ getEquipmentInventory }));
vi.mock("@/lib/notificationsServer", () => ({ getNotifications }));

import { getTechnicalSupportDashboard } from "@/lib/technicalSupportDashboardServer";

describe("SCRUM-164/AC1,AC2,AC3 reading the Technical Support Home", () => {
  it("SCRUM-164/AC1,AC2,AC3 passes each source through", async () => {
    getEquipmentQueue.mockResolvedValue({ requests: [{ id: "r1" }] });
    getEquipmentInventory.mockResolvedValue({ items: [{ id: "i1" }] });
    getNotifications.mockResolvedValue({ items: [{ id: "n1" }], unreadCount: 1 });
    expect(await getTechnicalSupportDashboard()).toEqual({ requests: [{ id: "r1" }], items: [{ id: "i1" }], notifications: [{ id: "n1" }] });
  });

  it("SCRUM-164/AC1,AC2,AC3 leaves a source that failed undefined and keeps the others", async () => {
    getEquipmentQueue.mockResolvedValue({ error: "down" });
    getEquipmentInventory.mockResolvedValue({ fieldErrors: { date: "bad" } });
    getNotifications.mockResolvedValue({ items: [], unreadCount: 0 });
    expect(await getTechnicalSupportDashboard()).toEqual({ requests: undefined, items: undefined, notifications: [] });
  });

  it("SCRUM-164/AC3 leaves notifications undefined when they could not be loaded", async () => {
    getEquipmentQueue.mockResolvedValue({ requests: [] });
    getEquipmentInventory.mockResolvedValue({ items: [] });
    getNotifications.mockResolvedValue({ error: "down" });
    expect((await getTechnicalSupportDashboard()).notifications).toBeUndefined();
  });
});
