import express from "express";
import type { SupabaseDeps } from "./supabase";
import { authRoutes } from "./routes/auth";
import { dashboardRoutes } from "./routes/dashboard";

// Exported separately from listen() (see server.ts) so tests can mount it without binding a port.
export function createApp(deps: SupabaseDeps) {
  const app = express();
  app.use(express.json());

  // The web app (a different origin in dev) calls this service directly, with cookies.
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

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "auth-service" }));
  app.use("/auth", authRoutes(deps));
  app.use("/dashboard", dashboardRoutes(deps));
  return app;
}
