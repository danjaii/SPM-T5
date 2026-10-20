import { isLead } from "@spm-t5/shared";

// SCRUM-122/AC3: routes with exactly one owning role. Other roles who open them get the access-denied page.
// Only unambiguous ones are listed; shared pages (venue catalogue, profile, event pages) stay open to every role that can use them.
const ROLE_ONLY: { prefix: string; role: string }[] = [
  { prefix: "/booking-queue", role: "venue_staff" },
  { prefix: "/safety-checks", role: "safety_officer" },
  { prefix: "/equipment-requests", role: "technical_support_staff" },
  { prefix: "/equipment-availability", role: "technical_support_staff" },
  { prefix: "/equipment-reservation", role: "technical_support_staff" },
];

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The route guard's matcher entries for the role-only routes, so middleware and this map cannot drift apart. */
export const ROLE_ONLY_MATCHERS = ROLE_ONLY.map(({ prefix }) => `${prefix}/:path*`);

/** SCRUM-122/AC3: may someone with this role open this path? Dashboards belong to their role, /lead to Leads. */
export function canOpen(role: string, pathname: string): boolean {
  if (under(pathname, "/lead")) return isLead(role);
  if (under(pathname, "/dashboard")) return pathname.split("/")[2] === role;
  const only = ROLE_ONLY.find(({ prefix }) => under(pathname, prefix));
  return !only || only.role === role;
}
