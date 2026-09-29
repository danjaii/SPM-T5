import express from "express";
import type { SupabaseDeps } from "./supabase";
import { eventRoutes } from "./routes/events";

// Exported separately from listen() so tests can mount the app without opening a port.
export function createApp(deps: SupabaseDeps) {
  const app = express();
  app.use(express.json()); // read JSON request bodies, e.g. { "status": "approved" }

  // The web app (a different origin in dev) calls this service directly from the browser, with cookies.
  // Same approach as auth-service's app.ts.
  app.use((req, res, next) => {
    const allowed = process.env.WEB_ORIGIN ?? "http://localhost:3000";
    if (req.headers.origin === allowed) {
      res.set({
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,PATCH,OPTIONS",
        Vary: "Origin",
      });
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use("/events", eventRoutes(deps));
  return app;
}
