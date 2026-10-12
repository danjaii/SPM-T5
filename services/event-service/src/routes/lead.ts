import { Router } from "express";
import type { SupabaseDeps } from "../supabase";
import { requireLead } from "../middlewares/lead";
import { requireSession, type SessionUser } from "../middlewares/session";

/** Postgres insufficient_privilege: what the Lead functions raise for a caller or coordinator they won't serve. */
const PG_DENIED = "42501";

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

  // SCRUM-81/AC1, AC3-AC6: the Lead's active coordinators with their workload counts (lead_coordinator_overview())
  router.get("/coordinators", async (_req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data, error } = await deps.forUser(token).rpc("lead_coordinator_overview");
    if (error) {
      console.error("lead_coordinator_overview failed:", error.message);
      return res.status(500).json({ error: "We couldn't load your coordinators. Please try again." });
    }
    return res.json(data ?? []);
  });

  // SCRUM-81/AC2, AC4: one coordinator's non-closed events; the database refuses a coordinator the Lead doesn't supervise
  router.get("/coordinators/:id/events", async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data, error } = await deps.forUser(token).rpc("lead_coordinator_events", { p_coordinator_id: req.params.id });
    if (error?.code === PG_DENIED) return res.status(403).json({ error: "You can only view coordinators you supervise." });
    if (error) {
      console.error("lead_coordinator_events failed:", error.message);
      return res.status(500).json({ error: "We couldn't load this coordinator's events. Please try again." });
    }
    return res.json(data ?? []);
  });

  return router;
}
