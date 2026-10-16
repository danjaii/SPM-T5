import express from "express";
import { errorHandler } from "./middlewares/errors";
import { requireSession } from "./middlewares/session";
import { SupabaseAccessReader, type AccessReader } from "./readers/accessReader";
import type { NotificationRepository } from "./repositories/notificationRepository";
import { SupabaseNotificationRepository } from "./repositories/supabaseNotificationRepository";
import { notificationRoutes } from "./routes/notifications";
import type { SupabaseDeps } from "./supabase";
import { healthCheck } from "./index";

export interface AppOptions {
  /** Where notifications come from; tests pass fakes. Defaults to Supabase queries as the caller. */
  repoFor?: (accessToken: string) => NotificationRepository;
  /** What the caller can still see of a notification's target; tests pass fakes. Defaults to Supabase as the caller. */
  accessFor?: (accessToken: string) => AccessReader;
}

// Exported separately from listen() (see server.ts) so tests can mount it without binding a port.
export function createApp(deps: SupabaseDeps, options: AppOptions = {}) {
  const repoFor = options.repoFor ?? ((token) => new SupabaseNotificationRepository(deps.forUser(token)));
  const accessFor = options.accessFor ?? ((token) => new SupabaseAccessReader(deps.forUser(token)));
  const app = express();
  app.use(express.json());

  // The web app (a different origin in dev) calls this service directly from the browser, with cookies.
  app.use((req, res, next) => {
    const allowed = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    if (req.headers.origin === allowed) {
      res.set({
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        Vary: "Origin",
      });
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  // Liveness check for docker compose and CI; before the session check, so no login needed.
  app.get("/health", (_req, res) => res.json(healthCheck()));

  // SCRUM-46: everything else needs a signed-in caller (401 otherwise).
  app.use("/notifications", requireSession(deps), notificationRoutes(repoFor, accessFor));

  app.use(errorHandler);
  return app;
}
