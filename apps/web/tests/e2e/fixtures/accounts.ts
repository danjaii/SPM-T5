import { resolve } from "node:path";
import type { Role } from "@spm-t5/shared";

// Seeded accounts (supabase/seed.sql), all with the password in env.ts. A "persona" is one named account; a test asks for
// a persona, not an email, so the choice of account is in one place.
//   - coordinator and coordinator2 are supervised by the same Lead (Helen); coordinator3 by the other (Samuel).
//   - Leads are system-wide since SCRUM-184, so either Lead sees and assigns every coordinator's events.

export const ACCOUNTS = {
  organiser: { email: "jason.chua@techconnect.example.com", role: "event_organiser" },
  organiser2: { email: "weiling.ong@techconnect.example.com", role: "event_organiser" },
  coordinator: { email: "rachel.tan@connectsphere.example.com", role: "event_coordinator" },
  coordinator2: { email: "marcus.lim@connectsphere.example.com", role: "event_coordinator" },
  coordinator3: { email: "priya.nair@connectsphere.example.com", role: "event_coordinator" },
  lead: { email: "helen.ong@connectsphere.example.com", role: "event_coordinator_lead" },
  lead2: { email: "samuel.tay@connectsphere.example.com", role: "event_coordinator_lead" },
  venueStaff: { email: "kenneth.wong@connectsphere.example.com", role: "venue_staff" },
  venueStaff2: { email: "farah.ibrahim@connectsphere.example.com", role: "venue_staff" },
  tech: { email: "aaron.koh@connectsphere.example.com", role: "technical_support_staff" },
  safety: { email: "farah.ismail@connectsphere.example.com", role: "safety_officer" },
  attendee: { email: "alicia.fernandez@example.com", role: "attendee" },
  attendee2: { email: "bryan.ho@example.com", role: "attendee" },
  // used by E2E-NOTIF-01 only, so nothing else writes to this account's notifications while it counts them
  attendee3: { email: "dylan.heng@example.com", role: "attendee" },
} as const satisfies Record<string, { email: string; role: Role }>;

export type Persona = keyof typeof ACCOUNTS;

export const PERSONAS = Object.keys(ACCOUNTS) as Persona[];

/** One persona per role: what the roles loops (sign-in, shell, access control) use. */
export const PRIMARY_BY_ROLE: Record<Role, Persona> = {
  event_organiser: "organiser",
  event_coordinator: "coordinator",
  event_coordinator_lead: "lead",
  venue_staff: "venueStaff",
  technical_support_staff: "tech",
  safety_officer: "safety",
  attendee: "attendee",
};

/**
 * Where signing in lands a role. Written out here, not read from the app. Every role has a dashboard, except that the Lead's
 * home is the unassigned queue (SCRUM-188); `/dashboard/event_coordinator_lead` only redirects there.
 */
export const homePath = (role: Role) => (role === "event_coordinator_lead" ? "/lead/queue" : `/dashboard/${role}`);

/** The label of each role in the sign-in form's "Continue as" list (apps/web/src/lib/roles.ts). */
export const ROLE_LABEL: Record<Role, string> = {
  event_organiser: "Event Organiser",
  event_coordinator: "Event Coordinator",
  event_coordinator_lead: "Event Coordinator Lead",
  venue_staff: "Venue Staff",
  technical_support_staff: "Technical Support Staff",
  safety_officer: "Safety Officer",
  attendee: "Attendee",
};

/** Absolute, so it does not depend on where Playwright was started from. Git-ignored. */
export const STORAGE_DIR = resolve(__dirname, "../.auth");
export const storageStatePath = (who: Persona) => resolve(STORAGE_DIR, `${who}.json`);
