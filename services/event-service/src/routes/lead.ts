import { Router } from "express";
import type { SupabaseDeps } from "../supabase";
import { requireLead } from "../middlewares/lead";
import { requireSession, type SessionUser } from "../middlewares/session";

/**
 * Event Coordinator Lead pages and actions (docs/specs/event-coordinator-lead-role.md). Every route is behind
 * requireSession + requireLead (SCRUM-75/AC7), and reads or writes as the caller so RLS applies too.
 */
export function leadRoutes(deps: SupabaseDeps) {
  const router = Router();
  router.use(requireSession(deps), requireLead(deps));

  // SCRUM-77/AC1-AC5: the shared queue; which requests are in it, and their order, is decided by lead_unassigned_queue()
  router.get("/queue", async (_req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data, error } = await deps.forUser(token).rpc("lead_unassigned_queue");
    if (error) {
      console.error("lead_unassigned_queue failed:", error.message);
      return res.status(500).json({ error: "We couldn't load the unassigned event requests. Please try again." });
    }
    return res.json(data ?? []);
  });

  return router;
}
