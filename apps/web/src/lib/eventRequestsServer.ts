import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SERVER_EVENT_URL, SESSION_COOKIE } from "./api";
import type { RoomLayoutOption } from "./eventRequests";

/** SCRUM-123: the room layouts the form offers, or event-service's reason it could not load them. */
export async function getRequestOptions(): Promise<{ roomLayouts: RoomLayoutOption[] } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");

  let res: Response;
  try {
    res = await fetch(`${SERVER_EVENT_URL}/events/request-options`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
  } catch {
    return { error: "We couldn't reach the server. Please try again." };
  }
  if (res.status === 401) redirect("/login");
  const data = await res.json().catch(() => ({}));
  return res.ok ? (data as { roomLayouts: RoomLayoutOption[] }) : { error: data.error ?? "We couldn't load the form. Please try again." };
}
