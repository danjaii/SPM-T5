import express from "express";
import type { SupabaseDeps } from "./supabase";
import { changeRequestRoutes } from "./routes/changeRequests";
import { changeRequestReviewRoutes } from "./routes/changeRequestReview";
import { eventDetailsRoutes } from "./routes/eventDetails";
import { eventRoutes } from "./routes/events";
import { eventRequestRoutes } from "./routes/eventRequests";
import { leadRoutes } from "./routes/lead";
import { upcomingEventRoutes } from "./routes/upcomingEvents";
import { registrationRoutes } from "./routes/registrations";
import { safetyDecisionRoutes, safetyCheckRoutes } from "./routes/safetyChecks";
import { cors } from "./middlewares/cors";
import { healthCheck } from "./index";

export interface AppOptions {
  /** The clock, injected so tests decide what "in the past" means (SCRUM-111 validation). */
  now?: () => Date;
}

// Exported separately from listen() so tests can mount the app without opening a port.
export function createApp(deps: SupabaseDeps, options: AppOptions = {}) {
  const now = options.now ?? (() => new Date());
  const app = express();
  app.use(cors());
  app.use(express.json()); // read JSON request bodies, e.g. { "status": "approved" }

  // SCRUM-94: liveness check for docker compose and CI; no session needed
  app.get("/health", (_req, res) => res.json(healthCheck()));

  // Before eventRoutes: its GET /events/:id would otherwise treat "upcoming" as an event id
  app.use("/events", upcomingEventRoutes(deps));
  app.use("/events", changeRequestRoutes(deps));
  app.use("/events", registrationRoutes(deps));
  app.use("/events", eventRequestRoutes(deps));
  // SCRUM-111: the assigned coordinator edits an event's details (PATCH /events/:id)
  app.use("/events", eventDetailsRoutes(deps, now));
  app.use("/events", eventRoutes(deps));
  // SCRUM-75: the Event Coordinator Lead's pages and actions
  app.use("/lead", leadRoutes(deps));
  // SCRUM-99: the Safety Officer's Operational Safety Check
  app.use("/safety-checks", safetyCheckRoutes(deps));
  // SCRUM-100/AC7: the event's coordinator and organiser see the Safety Officer's requested changes
  app.use("/events", safetyDecisionRoutes(deps));
  // SCRUM-67: the event's coordinator reviews its change requests
  app.use("/change-requests", changeRequestReviewRoutes(deps));
  return app;
}
