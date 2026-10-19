import express from "express";
import { errorHandler } from "./middlewares/errors";
import { requireSession } from "./middlewares/session";
import { supabasePorts, type PortsFactory } from "./ports";
import { equipmentRoutes } from "./routes/equipment";
import { equipmentRequestRoutes } from "./routes/equipmentRequests";
import { technicalAssignmentRoutes } from "./routes/technicalAssignments";
import { SupabaseTechnicalAssignmentStore, type TechnicalAssignmentStore } from "./repositories/technicalAssignmentStore";
import type { SupabaseDeps } from "./supabase";
import { healthCheck } from "./index";

export interface AppOptions {
  /** The clock, injected so tests can decide what "in the past" means. */
  now?: () => Date;
  /** Where data comes from; tests pass fakes. Defaults to Supabase queries as the caller. */
  ports?: PortsFactory;
  /** SCRUM-20: where on-site assignments are read and written; tests pass a fake. Defaults to Supabase as the caller. */
  assignments?: (accessToken: string) => TechnicalAssignmentStore;
}

// Exported separately from listen() so tests can mount the app without opening a port.
export function createApp(deps: SupabaseDeps, options: AppOptions = {}) {
  const now = options.now ?? (() => new Date());
  const portsFor = options.ports ?? supabasePorts(deps);
  const assignmentsFor = options.assignments ?? ((token: string) => new SupabaseTechnicalAssignmentStore(deps.forUser(token)));
  const app = express();
  // SCRUM-19: reservations arrive as JSON in the request body (POST), so read it into req.body.
  app.use(express.json());

  // CORS: the web app (localhost:3000) calls this service straight from the browser, with its login cookie.
  // Only that address gets permission to read the replies; any other website gets none, so the browser blocks
  // it. Same approach as venue-service's app.ts; SCRUM-18 only reads (GET); SCRUM-19 reserves with a POST;
  // SCRUM-87 changes a request's status with a PATCH.
  app.use((req, res, next) => {
    const allowed = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    if (req.headers.origin === allowed) {
      res.set({
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
        Vary: "Origin",
      });
    }
    // The browser's "may I?" check (OPTIONS) is answered here, before the login check, since it carries no cookie.
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // SCRUM-94: liveness check for docker compose and CI; before the session check, so no login needed
  app.get("/health", (_req, res) => res.json(healthCheck()));

  // Everything needs a signed-in caller. Routes are added as each story lands.
  app.use(
    requireSession(deps),
    equipmentRoutes(portsFor, now),
    equipmentRequestRoutes(portsFor),
    technicalAssignmentRoutes(portsFor, assignmentsFor),
  );

  app.use(errorHandler);
  return app;
}
