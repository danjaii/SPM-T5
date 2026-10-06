import { Router } from "express";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";
import { toUpcomingEvents, type PublicEventRow } from "../services/upcomingEvents";

/** SCRUM-71: the attendee's List of events. */
export function upcomingEventRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-71/AC1: each listed event with its name, start and end time, and venue
  // SCRUM-71/AC2: only events that haven't started yet (compared with the time of this request)
  router.get("/upcoming", requireSession(deps), async (_req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data, error } = await deps.forUser(token).rpc("list_public_events");
    // SCRUM-71/AC11: "No upcoming events" must mean there are none, so a failed call is an error, not []
    if (error) return res.status(500).json({ error: "We couldn't load upcoming events. Please try again." });
    res.json(toUpcomingEvents((data ?? []) as PublicEventRow[], new Date()));
  });

  return router;
}
