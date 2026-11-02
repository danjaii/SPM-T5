import { sgtToUtc, utcToSgt, type RegistrationSettings } from "@spm-t5/shared";
import { EVENT_URL, type ApiResult } from "./api";

/**
 * SCRUM-185/AC4: what the coordinator's Registration settings form starts from (GET /events/:id/registration-settings), with the
 * times as UTC instants as the service sends them.
 */
export interface RegistrationSettingsView {
  status: string;
  registrationRequired: boolean;
  capacity: number | null;
  opensAt: string | null;
  closesAt: string | null;
  eventStart: string | null;
  /** Only Confirmed registrations hold a place, so this is how far the capacity can be lowered. */
  confirmedCount: number;
  /** Registration is closed to attendees while the event is not Confirmed (register_for_event, migration 68). */
  closedByStatus: boolean;
}

/** An ISO instant -> a datetime-local value in Singapore time, "" when empty or not a date. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const { date, time } = utcToSgt(at);
  return `${date}T${time}`;
}

/** A datetime-local value in Singapore time -> an ISO instant, undefined when it is empty or not a date, so the shared rule reports it. */
export function fromLocalInput(local: string): string | undefined {
  const [date, time] = local.split("T");
  if (!date || !time) return undefined;
  const at = sgtToUtc(date, time.slice(0, 5));
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/** SCRUM-185/AC4: saves the settings (the assigned coordinator only; event-service checks again, and so does the database). */
export async function saveRegistrationSettings(eventId: string, body: RegistrationSettings): Promise<ApiResult<{ capacity?: number }>> {
  try {
    const res = await fetch(`${EVENT_URL}/events/${encodeURIComponent(eventId)}/registration-settings`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}
