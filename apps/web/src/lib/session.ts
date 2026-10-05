import { AUTH_URL } from "./api";
import { getJson } from "./http";

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

/** Who is signed in, according to auth-service. Throws UnauthorizedError when nobody is. */
export function fetchCurrentUser(signal?: AbortSignal): Promise<CurrentUser> {
  return getJson<CurrentUser>(`${AUTH_URL}/auth/me`, signal);
}
