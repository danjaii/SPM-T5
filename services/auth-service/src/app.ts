import express from "express";
import type { SupabaseDeps } from "./supabase";
import { authRoutes } from "./routes/auth";
import { dashboardRoutes } from "./routes/dashboard";
import { profileRoutes } from "./routes/profile";
import { cors } from "./middlewares/cors";

// Exported separately from listen() (see server.ts) so tests can mount it without binding a port.
export function createApp(deps: SupabaseDeps) {
  const app = express();
  app.use(express.json());

  // The web app (a different origin in dev) calls this service directly, with cookies.
  app.use(cors());

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "auth-service" }));
  app.use("/auth", authRoutes(deps));
  app.use("/dashboard", dashboardRoutes(deps));
  app.use("/profile", profileRoutes(deps));
  return app;
}
