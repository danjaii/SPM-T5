import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EQUIPMENT_URL, SESSION_COOKIE } from "./api";
import type { EquipmentRequestFormData, EventEquipmentRequestsView } from "./equipmentRequests";

// Server-only: reads equipment-service with the login cookie via next/headers. Client components must not
// import this file; the browser-safe types and the submit call live in ./equipmentRequests.

/** SCRUM-86/AC1: the request form's data. AC6, AC7: equipment-service refuses, and its message is shown instead. */
export async function getEquipmentRequestForm(eventId: string): Promise<{ form: EquipmentRequestFormData } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_EQUIPMENT_URL}/events/${encodeURIComponent(eventId)}/equipment-request-form`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't reach the server. Please try again." };
  }
  if (res.status === 401) redirect("/login");
  const data = await res.json();
  return res.ok ? { form: data } : { error: data.error ?? "We couldn't load the equipment request form." };
}

/**
 * SCRUM-86/AC2, AC3: the event's equipment requests, for the event page. null when the viewer may not see them (or
 * the service can't be reached), so the page simply leaves the section out, as it does for the venue booking.
 */
export async function getEventEquipmentRequests(eventId: string): Promise<EventEquipmentRequestsView | null> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!token) return null;
    const res = await fetch(`${SERVER_EQUIPMENT_URL}/events/${encodeURIComponent(eventId)}/equipment-requests`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as EventEquipmentRequestsView) : null;
  } catch {
    return null;
  }
}
