import { Router } from "express";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";
import { toUpcomingEvents, type PublicEventRow } from "../services/upcomingEvents";

/** SCRUM-71: the attendee's List of events. */
export function upcomingEventRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-71/AC1: each listed event with its name, start and end time, and venue
  router.get("/upcoming", requireSession(deps), async (_req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data } = await deps.forUser(token).rpc("list_public_events");
    res.json(toUpcomingEvents((data ?? []) as PublicEventRow[]));
  });

  return router;
}
