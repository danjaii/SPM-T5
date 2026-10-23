import { Router } from "express";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";
import { lookUpRole } from "./events";

/** SCRUM-52/AC1: the most requests one organiser's list shows. Far above what anyone creates, but it keeps one read bounded. */
export const MY_REQUESTS_LIMIT = 500;

/** SCRUM-52: an organiser's own event requests. */
export function myEventRequestRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-52/AC1: every request the organiser created, newest first, with its current status
  // SCRUM-52/AC2: read as the caller (RLS, migration 14) and filtered to their own, so another organiser's never appears
  router.get("/my-requests", requireSession(deps), async (_req, res) => {
    const user = res.locals.user as SessionUser;
    const role = await lookUpRole(deps, user);
    if (role !== "event_organiser") {
      return res.status(403).json({ error: "You are not allowed to view event requests created by organisers." });
    }
    const { data, error } = await deps
      .forUser(user.token)
      .from("events")
      .select("id, name, status, preferred_start_datetime, expected_attendance, submitted_at")
      .eq("organiser_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MY_REQUESTS_LIMIT);
    // "No requests" must mean there are none, so a failed read, or one that gave back nothing at all, is an error, not []
    if (error || !data) return res.status(500).json({ error: "We couldn't load your event requests. Please try again." });
    return res.json(data);
  });

  return router;
}
