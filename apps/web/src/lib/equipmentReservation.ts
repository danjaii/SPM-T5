// Browser-safe types and the call for reserving equipment (SCRUM-19). The server-side fetches of the events and the
// equipment live in ./equipmentReservationServer.

import { EQUIPMENT_URL, type ApiResult } from "./api";

/** GET /reservable-events: an event equipment can be reserved for. Date and times are Singapore time. */
export interface ReservableEventView {
  id: string;
  name: string;
  status: string;
  date: string;
  startTime: string;
  endTime: string;
  coordinatorName: string | null;
}

/** GET /equipment: a catalogue item, shown as a card. */
export interface EquipmentCardView {
  id: string;
  name: string;
  type: string | null;
  totalQuantity: number;
  operationalStatus: string;
}

/** POST /equipment-reservations: the form's fields exactly as typed; equipment-service checks them again. */
export interface ReservationRequest {
  eventId: string;
  equipmentId: string;
  quantity: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** The 201 reply: what was reserved (date and times are Singapore time) and how many are still free for that period. */
export interface ReservationConfirmationView {
  id: string;
  equipmentName: string;
  quantity: number;
  date: string;
  startTime: string;
  endTime: string;
  availableAfter: number;
}

/** Asks equipment-service from the browser to reserve the equipment, sending the login cookie. */
export async function reserveEquipment(request: ReservationRequest): Promise<ApiResult<ReservationConfirmationView>> {
  try {
    const res = await fetch(`${EQUIPMENT_URL}/equipment-reservations`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return {
      ok: false,
      data: { error: "We couldn't reach the server. Please try again." } as ApiResult<ReservationConfirmationView>["data"],
    };
  }
}
