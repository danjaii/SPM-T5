import { Router } from "express";
import { canReviewEvents, isRole } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";

export function eventRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-6: an event coordinator views the current status of any event
  router.get("/:id", requireSession(deps), async (req, res) => {
    const { id: userId, token } = res.locals.user as SessionUser;

    // SCRUM-6 AC3: only event coordinators may view event status (organisers come with SCRUM-7)
    const { data: profile } = await deps.forUser(token).from("users").select("role").eq("id", userId).maybeSingle();
    if (!isRole(profile?.role) || !canReviewEvents(profile.role)) {
      return res.status(403).json({ error: "You are not allowed to view this event's status." });
    }

    const { data: event } = await deps
      .forUser(token)
      .from("events")
      .select("id, name, status")
      .eq("id", req.params.id)
      // the following line is commented out because we don't restrict only assigned coord to see event status
      // .eq("assigned_coordinator_id", userId)
      .maybeSingle();

    res.json(event);
  });

  return router;
}
