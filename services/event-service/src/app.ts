import express from "express";
import type { SupabaseDeps } from "./supabase";
import { changeRequestRoutes } from "./routes/changeRequests";
import { eventRoutes } from "./routes/events";
import { upcomingEventRoutes } from "./routes/upcomingEvents";
import { cors } from "./middlewares/cors";

// Exported separately from listen() so tests can mount the app without opening a port.
export function createApp(deps: SupabaseDeps) {
  const app = express();
  app.use(cors());
  app.use(express.json()); // read JSON request bodies, e.g. { "status": "approved" }

  // Before eventRoutes: its GET /events/:id would otherwise treat "upcoming" as an event id
  app.use("/events", upcomingEventRoutes(deps));
  app.use("/events", changeRequestRoutes(deps));
  app.use("/events", eventRoutes(deps));
  return app;
}
