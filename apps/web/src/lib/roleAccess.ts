import { canViewVenueCalendar, isLead, type Role } from "@spm-t5/shared";

// SCRUM-122/AC3: routes with exactly one owning role. Other roles who open them get the access-denied page.
// Only unambiguous ones are listed; shared pages (venue catalogue, profile, event pages) stay open to every role that can use them.
const ROLE_ONLY: { prefix: string; role: string }[] = [
  { prefix: "/booking-queue", role: "venue_staff" },
  { prefix: "/safety-checks", role: "safety_officer" },
  { prefix: "/equipment-requests", role: "technical_support_staff" },
  { prefix: "/equipment-availability", role: "technical_support_staff" },
  { prefix: "/equipment-inventory", role: "technical_support_staff" }, // SCRUM-137/AC2
  { prefix: "/equipment-reservation", role: "technical_support_staff" },
  // SCRUM-52/AC2: an organiser's own requests
  { prefix: "/my-event-requests", role: "event_organiser" },
];

// SCRUM-84/AC8: routes several roles share. The rule is the shared one, so the web and venue-service agree on who may open it.
const MULTI_ROLE: { prefix: string; allows: (role: Role) => boolean }[] = [
  { prefix: "/venue-calendar", allows: canViewVenueCalendar },
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The route guard's matcher entries for the role-only routes, so middleware and this map cannot drift apart. */
export const ROLE_ONLY_MATCHERS = ROLE_ONLY.map(({ prefix }) => `${prefix}/:path*`);

/** The route guard's matcher entries for the multi-role routes. */
export const MULTI_ROLE_MATCHERS = MULTI_ROLE.map(({ prefix }) => `${prefix}/:path*`);

/** SCRUM-122/AC3: may someone with this role open this path? Dashboards belong to their role, /lead to Leads. */
export function canOpen(role: string, pathname: string): boolean {
  if (under(pathname, "/lead")) return isLead(role);
  if (under(pathname, "/dashboard")) return pathname.split("/")[2] === role;
  const shared = MULTI_ROLE.find(({ prefix }) => under(pathname, prefix));
  if (shared) return shared.allows(role as Role);
  const only = ROLE_ONLY.find(({ prefix }) => under(pathname, prefix));
  return !only || only.role === role;
}
