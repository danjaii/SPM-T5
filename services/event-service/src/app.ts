import express from "express";
import type { SupabaseDeps } from "./supabase";
import { eventRoutes } from "./routes/events";
import { cors } from "./middlewares/cors";

// Exported separately from listen() so tests can mount the app without opening a port.
export function createApp(deps: SupabaseDeps) {
  const app = express();
  app.use(cors());
  app.use(express.json()); // read JSON request bodies, e.g. { "status": "approved" }

  app.use("/events", eventRoutes(deps));
  return app;
}
