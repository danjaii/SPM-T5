import express from "express";
import { errorHandler } from "./middlewares/errors";
import { requireSession } from "./middlewares/session";
import { supabasePorts, type PortsFactory } from "./ports";
import { venueBookingRoutes } from "./routes/venueBookings";
import type { SupabaseDeps } from "./supabase";

export interface AppOptions {
  /** The clock, injected so tests can decide what "in the past" means (32-S5). */
  now?: () => Date;
  /** Where data comes from; tests pass fakes. Defaults to Supabase queries as the caller. */
  ports?: PortsFactory;
}

// Exported separately from listen() so tests can mount the app without opening a port.
export function createApp(deps: SupabaseDeps, options: AppOptions = {}) {
  const now = options.now ?? (() => new Date());
  const portsFor = options.ports ?? supabasePorts(deps);
  const app = express();
  app.use(express.json());

  // The web app (a different origin in dev) calls this service directly from the browser, with cookies.
  // Same approach as event-service's app.ts, plus POST for submit/withdraw/amend.
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

  // Everything below needs a signed-in caller (DR2: 401). Routes are added as each story lands.
  app.use(requireSession(deps), venueBookingRoutes(portsFor, now));

  app.use(errorHandler);
  return app;
}
