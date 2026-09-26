import { NextResponse, type NextRequest } from "next/server";
import { SERVER_AUTH_URL, SESSION_COOKIE } from "@/lib/api";

// Route guard for /dashboard/*. Asks auth-service who the caller is on every request, so a logged-out
// session (or the Back button after logging out) can never render a dashboard.
export async function middleware(request: NextRequest) {
  const toLogin = () => {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete(SESSION_COOKIE);
    return response;
  };

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return toLogin();

  let role: string;
  try {
    const me = await fetch(`${SERVER_AUTH_URL}/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
      cache: "no-store",
    });
    if (!me.ok) return toLogin();
    role = (await me.json()).role;
  } catch {
    return toLogin();
  }

  // Each role only gets its own dashboard; anything else is sent to it.
  const requested = request.nextUrl.pathname.split("/")[2];
  if (requested !== role) return NextResponse.redirect(new URL(`/dashboard/${role}`, request.url));

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/dashboard/:path*"] };
