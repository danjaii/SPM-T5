import { cookies } from "next/headers";
import { SERVER_AUTH_URL, SESSION_COOKIE } from "./api";

/** The signed-in user's role, asked of auth-service with their cookie; undefined when it cannot be told. middleware.ts has already guarded the route. */
export async function getCurrentRole(): Promise<string | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  try {
    const res = await fetch(`${SERVER_AUTH_URL}/auth/me`, { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` }, cache: "no-store" });
    return res.ok ? ((await res.json()) as { role?: string }).role : undefined;
  } catch {
    return undefined;
  }
}
