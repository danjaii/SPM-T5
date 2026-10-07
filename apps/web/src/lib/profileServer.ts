import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_AUTH_URL, SESSION_COOKIE } from "./api";
import type { ProfileView } from "./profile";

// Server-only: reads auth-service with the login cookie via next/headers. Client components must not
// import this file; the browser-safe types and the save call live in ./profile.

/** SCRUM-68: the signed-in user's own profile, fetched as that user; or a message to show if it could not be loaded. */
export async function getProfile(): Promise<{ profile: ProfileView } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const headers = { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` };

  let res: Response;
  try {
    res = await fetch(`${SERVER_AUTH_URL}/profile`, { headers, cache: "no-store" });
  } catch {
    return { error: "We couldn't reach the server. Please try again." };
  }
  if (res.status === 401) redirect("/login");
  const body = await res.json();
  if (!res.ok) return { error: body.error };
  return { profile: body };
}
