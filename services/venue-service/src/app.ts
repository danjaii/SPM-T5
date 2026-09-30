import express from "express";
import { errorHandler } from "./middlewares/errors";
import type { SupabaseDeps } from "./supabase";
import { venueRoutes } from "./routes/venues";

// Exported separately from listen() so tests can mount the app without opening a port.
export function createApp(deps: SupabaseDeps) {
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

  app.use("/venues", venueRoutes(deps));
  // Booking routes are mounted here as each story lands (SCRUM-32 onwards).

  app.use(errorHandler);
  return app;
}
