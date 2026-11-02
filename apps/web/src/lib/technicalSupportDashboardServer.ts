import type { NotificationItem } from "@spm-t5/shared";
import { utcToSgt } from "@spm-t5/shared";
import type { InventoryItemView } from "./equipmentInventory";
import { getEquipmentInventory } from "./equipmentInventoryServer";
import type { EquipmentQueueItemView } from "./equipmentRequests";
import { getEquipmentQueue } from "./equipmentRequestsServer";
import { getNotifications } from "./notificationsServer";

// Server-only: what the Technical Support Staff Home (SCRUM-164) reads. Each source stands alone: one that fails is
// undefined, so the page can say "Unavailable" for that part and still show the rest.

export interface TechnicalSupportDashboardData {
  requests?: EquipmentQueueItemView[];
  items?: InventoryItemView[];
  notifications?: NotificationItem[];
}

export async function getTechnicalSupportDashboard(): Promise<TechnicalSupportDashboardData> {
  // Out of service does not depend on the period; today's working hours, as the Inventory page starts on, is only a valid one to ask with.
  const [queue, inventory, notifications] = await Promise.all([
    getEquipmentQueue(),
    getEquipmentInventory({ date: utcToSgt(new Date()).date, startTime: "07:00", endTime: "23:00" }),
    getNotifications(),
  ]);
  return {
    requests: "requests" in queue ? queue.requests : undefined,
    items: "items" in inventory ? inventory.items : undefined,
    notifications: "items" in notifications ? notifications.items : undefined,
  };
}
