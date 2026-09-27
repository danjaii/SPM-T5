import { Router } from "express";
import { canReviewEvents, isRole } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";

export function eventRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-6: an event coordinator views the current status of any event
  router.get("/:id", requireSession(deps), async (req, res) => {
    const { id: userId, token } = res.locals.user as SessionUser;

    // SCRUM-6 AC3: only event coordinators and (SCRUM-7) event organisers may view event status
    const { data: profile } = await deps.forUser(token).from("users").select("role").eq("id", userId).maybeSingle();
    const role = isRole(profile?.role) ? profile.role : undefined;
    const isCoordinator = role !== undefined && canReviewEvents(role);
    const isOrganiser = role === "event_organiser";
    if (!isCoordinator && !isOrganiser) {
      return res.status(403).json({ error: "You are not allowed to view this event's status." });
    }

    let query = deps
      .forUser(token)
      .from("events")
      .select("id, name, status")
      .eq("id", req.params.id);
      // the following line is commented out because we don't restrict only assigned coord to see event status
      // .eq("assigned_coordinator_id", userId)

    // SCRUM-7 AC3: an organiser only sees events they submitted
    if (isOrganiser) query = query.eq("organiser_id", userId);

    const { data: event } = await query.maybeSingle();

    // SCRUM-7 AC3: someone else's event looks exactly like one that doesn't exist
    if (!event) return res.status(404).json({ error: "Event not found." });

    res.json(event);
  });

  return router;
}
