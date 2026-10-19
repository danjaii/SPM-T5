import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EQUIPMENT_URL, SESSION_COOKIE } from "./api";
import type {
  EquipmentQueueItemView,
  EquipmentRequestDetailView,
  EquipmentRequestEditFormData,
  EquipmentRequestFormData,
  EventEquipmentRequestsView,
} from "./equipmentRequests";

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
 * SCRUM-88/AC1: the change form's data, starting on the request's current details. AC4, AC6 and Released requests:
 * equipment-service refuses, and its message is shown instead.
 */
export async function getEquipmentRequestEditForm(
  eventId: string,
  requestId: string,
): Promise<{ form: EquipmentRequestEditFormData } | { error: string }> {
  const res = await fromEquipmentService(
    `/events/${encodeURIComponent(eventId)}/equipment-requests/${encodeURIComponent(requestId)}/edit-form`,
  );
  if (!res) return { error: UNREACHABLE };
  const data = await res.json();
  return res.ok ? { form: data } : { error: data.error ?? "We couldn't load the equipment request." };
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

/** Asks equipment-service for `path` as the signed-in user; anyone not signed in goes to the sign-in page. */
async function fromEquipmentService(path: string): Promise<Response | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_EQUIPMENT_URL}${path}`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return undefined;
  }
  if (res.status === 401) redirect("/login");
  return res;
}

const UNREACHABLE = "We couldn't reach the server. Please try again.";

/** SCRUM-87/AC1, AC2: the requests waiting for action. AC7: anyone but Technical Support Staff gets the 403 message. */
export async function getEquipmentQueue(): Promise<{ requests: EquipmentQueueItemView[] } | { error: string }> {
  const res = await fromEquipmentService("/equipment-requests");
  if (!res) return { error: UNREACHABLE };
  const data = await res.json();
  return res.ok ? { requests: data } : { error: data.error ?? "We couldn't load the equipment requests." };
}

/** SCRUM-87/AC3: one request in full. */
export async function getEquipmentRequest(id: string): Promise<{ request: EquipmentRequestDetailView } | { error: string }> {
  const res = await fromEquipmentService(`/equipment-requests/${encodeURIComponent(id)}`);
  if (!res) return { error: UNREACHABLE };
  const data = await res.json();
  return res.ok ? { request: data } : { error: data.error ?? "We couldn't load this equipment request." };
}
