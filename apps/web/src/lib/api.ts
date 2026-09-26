// auth-service, called directly (no gateway). The browser and the Next.js server can reach it
// at different addresses (e.g. inside docker compose), so the server side has its own override.
export const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "http://localhost:4001";
export const SERVER_AUTH_URL = process.env.AUTH_SERVICE_URL ?? AUTH_URL;

export const SESSION_COOKIE = "cs_session";

export interface ApiResult<T> {
  ok: boolean;
  data: T & { error?: string; message?: string; fieldErrors?: Record<string, string> };
}

/** POST JSON to auth-service from the browser, sending/receiving the session cookie. */
export async function postJson<T = Record<string, never>>(path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${AUTH_URL}${path}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as ApiResult<T>["data"] };
  }
}
