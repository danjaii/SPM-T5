import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EQUIPMENT_URL, SESSION_COOKIE } from "./api";
import type { EquipmentCardView, ReservableEventView } from "./equipmentReservation";

// Server-only: reads equipment-service with the login cookie via next/headers. Client components must not
// import this file; the browser-safe types and the reserve call live in ./equipmentReservation.

/** SCRUM-19: the two lists the reservation page needs, fetched as the signed-in user. */
export async function getReservationFormData(): Promise<
  { events: ReservableEventView[]; equipment: EquipmentCardView[] } | { error: string }
> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const headers = { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token ?? "")}` };

  let events: Response;
  let equipment: Response;
  try {
    [events, equipment] = await Promise.all([
      fetch(`${SERVER_EQUIPMENT_URL}/reservable-events`, { headers, cache: "no-store" }),
      fetch(`${SERVER_EQUIPMENT_URL}/equipment`, { headers, cache: "no-store" }),
    ]);
  } catch {
    return { error: "We couldn't reach the server. Please try again." };
  }
  if (events.status === 401 || equipment.status === 401) redirect("/login");
  for (const reply of [events, equipment]) {
    if (!reply.ok) return { error: (await reply.json()).error };
  }
  return { events: await events.json(), equipment: await equipment.json() };
}
