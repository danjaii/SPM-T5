import { Router } from "express";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";

export function eventRoutes(deps: SupabaseDeps) {
  const router = Router();

  // SCRUM-6: an event coordinator views the current status of any event
  router.get("/:id", requireSession(deps), async (req, res) => {
        const { token } = res.locals.user as SessionUser;


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
