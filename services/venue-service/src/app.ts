import express from "express";
import type { SupabaseDeps } from "./supabase";
import { venueRoutes } from "./routes/venues";

// Exported separately from listen() so tests can mount the app without opening a port.
export function createApp(deps: SupabaseDeps) {
  const app = express();
  app.use(express.json());
  app.use("/venues", venueRoutes(deps));
  return app;
}
