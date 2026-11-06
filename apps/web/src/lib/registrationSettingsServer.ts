import { cookies } from "next/headers";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";
import type { RegistrationSettingsView } from "./registrationSettings";

/**
 * SCRUM-185/AC4: the event's registration settings, for its assigned coordinator (event-service answers 403 to anyone else). Null when
 * this viewer may not change them or they can't be loaded, so the Registrations tab simply leaves the form out.
 */
export async function getRegistrationSettings(id: string): Promise<RegistrationSettingsView | null> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const res = await fetch(`${SERVER_EVENT_URL}/events/${encodeURIComponent(id)}/registration-settings`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token ?? "")}` },
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as RegistrationSettingsView) : null;
  } catch {
    return null;
  }
}
