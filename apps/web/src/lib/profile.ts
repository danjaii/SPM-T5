import type { Role } from "@spm-t5/shared";
import { AUTH_URL, type ApiResult } from "./api";

// SCRUM-68: browser-safe types (and, later, the save call) for the profile page. The server-only loader is ./profileServer.

/** The profile as auth-service sends it (GET /profile). */
export interface ProfileView {
  fullName: string;
  /** The contact email. The login email is separate and never changes here. */
  email: string;
  loginEmail: string;
  phone: string | null;
  communicationPreferences: { email: boolean; sms: boolean };
  role: Role;
  /** Event Organisers only. */
  organisation: { name: string } | null;
  /** Internal users only (SCRUM-69): `null` when none is recorded, and for everyone else. */
  department: string | null;
  /** Internal users only (SCRUM-69): what their role is responsible for. Empty for everyone else. */
  responsibilities: string[];
  // we want to show organisation name if the person is an event organiser
}

/** What the form sends when Save is pressed (PATCH /profile): the four details the person may change, as they now are. */
export interface ProfileChanges {
  fullName: string;
  email: string;
  phone: string;
  communicationPreferences: { email: boolean; sms: boolean };
}

/** SCRUM-68: sends the changes to auth-service from the browser (PATCH /profile), with the login cookie. */
export async function saveProfile(changes: ProfileChanges): Promise<ApiResult<ProfileView>> {
  try {
    const res = await fetch(`${AUTH_URL}/profile`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as ApiResult<ProfileView>["data"] };
  }
}
