// Where the E2E stack lives. playwright.config.ts starts the services on these ports, and the fixtures call them.
// The web must stay on port 3000: it is the only origin the services allow (WEB_ORIGIN).

export const PASSWORD = "ConnectSphere2026!";
export const WEB_URL = "http://localhost:3000";

/** CI uses the ports the web app defaults to (4001-4005). Locally 4101-4105, so a developer's own servers are left alone. */
export const SERVICE_PORT_BASE = Number(process.env.E2E_SERVICE_PORT_BASE ?? (process.env.CI ? 4001 : 4101));

export const SERVICES = [
  { key: "auth", dir: "auth-service", port: SERVICE_PORT_BASE },
  { key: "event", dir: "event-service", port: SERVICE_PORT_BASE + 1 },
  { key: "venue", dir: "venue-service", port: SERVICE_PORT_BASE + 2 },
  { key: "equipment", dir: "equipment-service", port: SERVICE_PORT_BASE + 3 },
  { key: "notification", dir: "notification-service", port: SERVICE_PORT_BASE + 4 },
] as const;

export type ServiceKey = (typeof SERVICES)[number]["key"];

export const SERVICE_URL = Object.fromEntries(
  SERVICES.map((s) => [s.key, `http://localhost:${s.port}`]),
) as Record<ServiceKey, string>;

/** The local Supabase stack. The secret key is the service role: it bypasses RLS, so only fixtures use it, to arrange data. */
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
export const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
