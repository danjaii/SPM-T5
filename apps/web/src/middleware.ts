import { NextResponse, type NextRequest } from "next/server";
import { SERVER_AUTH_URL, SESSION_COOKIE } from "@/lib/api";
import { canOpen } from "@/lib/roleAccess";

// SCRUM-83: an event's registration form, /events/<id>/register
const REGISTRATION_FORM = /^\/events\/[^/]+\/register$/;

// Route guard for /dashboard/*, Lead pages, role-only pages and registration forms. Asks auth-service who the caller is on every request, so a
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

  // SCRUM-159/AC3: "← Back to dashboard" links to plain /dashboard, which names no role; it means the caller's own home
  if (pathname === "/dashboard" || pathname === "/dashboard/") {
    return NextResponse.redirect(new URL(`/dashboard/${role}`, request.url));
  }

  // SCRUM-122/AC3: a page outside the caller's role shows the access-denied page (with a link to their home), not a silent bounce.
  // SCRUM-83/AC2: a registration form isn't role-bound, so a signed-in user carries on to it.
  // SCRUM-75/AC7: Lead pages are for Leads only.
  if (!REGISTRATION_FORM.test(pathname) && !canOpen(role, pathname)) {
    return NextResponse.redirect(new URL("/access-denied", request.url));
  }

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  return response;
}

// Next.js reads this at build time, so it must be a literal (no spread); roleAccess.test.ts checks the role-only entries match ROLE_ONLY_MATCHERS.
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/lead/:path*",
    "/events/:id/register",
    "/booking-queue/:path*",
    "/safety-checks/:path*",
    "/equipment-requests/:path*",
    "/equipment-availability/:path*",
    "/equipment-inventory/:path*",
    "/equipment-reservation/:path*",
    "/my-event-requests/:path*",
  ],
};
