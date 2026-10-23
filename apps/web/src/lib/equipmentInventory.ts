import type { EquipmentHolderView, OutOfServiceReason } from "./equipmentRequests";

// Browser-safe types for the inventory (SCRUM-137/AC2). The server-side fetch lives in ./equipmentInventoryServer.

/** GET /equipment-inventory: one catalogue item for the period asked about. */
export interface InventoryItemView {
  id: string;
  name: string;
  type: string | null;
  total: number;
  /** Free, working units: the total less units held by other events and less anything out of service. */
  available: number;
  heldBy: EquipmentHolderView[];
  outOfService: OutOfServiceReason | null;
}

/** The period the inventory is shown for, as the form's fields (Singapore time). */
export interface InventoryPeriodQuery {
  date: string;
  startTime: string;
  endTime: string;
}
