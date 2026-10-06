import { EQUIPMENT_URL, type ApiResult } from "./api";

// Browser-safe types and the call for the availability check (SCRUM-18). The server-side fetch of the
// equipment names lives in ./equipmentAvailabilityServer.

/** GET /equipment: a catalogue item offered as a name suggestion. */
export interface EquipmentOption {
  id: string;
  name: string;
  operationalStatus: string;
}

/** GET /equipment-availability. Date and times are Singapore time. */
export interface AvailabilityResultView {
  equipmentId: string;
  equipmentName: string;
  operationalStatus: string;
  totalQuantity: number;
  requestedQuantity: number;
  availableQuantity: number;
  sufficient: boolean;
  shortfall: number;
  date: string;
  startTime: string;
  endTime: string;
}

/** The form's five fields exactly as typed; equipment-service checks them again. */
export interface AvailabilityQuery {
  equipmentName: string;
  quantity: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** Asks equipment-service from the browser, sending the login cookie. */
export async function checkEquipmentAvailability(query: AvailabilityQuery): Promise<ApiResult<AvailabilityResultView>> {
  try {
    const res = await fetch(`${EQUIPMENT_URL}/equipment-availability?${new URLSearchParams({ ...query }).toString()}`, {
      credentials: "include",
      cache: "no-store",
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return {
      ok: false,
      data: { error: "We couldn't reach the server. Please try again." } as ApiResult<AvailabilityResultView>["data"],
    };
  }
}

const UNUSABLE_REASON: Record<string, string> = {
  damaged: "This equipment is damaged, so none can be used.",
  under_maintenance: "This equipment is under maintenance, so none can be used.",
  retired: "This equipment has been retired, so none can be used.",
};

/** 18-S10: why nothing is available, for equipment that is not usable; null when it is usable. */
export function unusableReason(operationalStatus: string): string | null {
  return UNUSABLE_REASON[operationalStatus] ?? null;
}
