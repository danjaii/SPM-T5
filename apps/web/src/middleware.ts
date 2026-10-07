import { NextResponse, type NextRequest } from "next/server";
import { SERVER_AUTH_URL, SESSION_COOKIE } from "@/lib/api";

// SCRUM-83: an event's registration form, /events/<id>/register
const REGISTRATION_FORM = /^\/events\/[^/]+\/register$/;

// Route guard for /dashboard/* and registration forms. Asks auth-service who the caller is on every request, so a
// logged-out session (or the Back button after logging out) can never render a dashboard.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const toLogin = () => {
    const login = new URL("/login", request.url);
    // SCRUM-83/AC2: a guest who selected Register is returned to the registration form after signing in
    if (REGISTRATION_FORM.test(pathname)) login.searchParams.set("next", pathname);
    const response = NextResponse.redirect(login);
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
  // SCRUM-83/AC2: a registration form isn't a dashboard, so a signed-in user carries on to it.
  const requested = pathname.split("/")[2];
  if (!REGISTRATION_FORM.test(pathname) && requested !== role) return NextResponse.redirect(new URL(`/dashboard/${role}`, request.url));

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/dashboard/:path*", "/events/:id/register"] };
