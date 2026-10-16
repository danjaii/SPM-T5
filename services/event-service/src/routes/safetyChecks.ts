import { Router } from "express";
import { SAFETY_DECISION_LABELS, safetyDecisionProblem, type SafetyDecision } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSafetyOfficer } from "../middlewares/safetyOfficer";
import { requireSession, type SessionUser } from "../middlewares/session";

/** How record_safety_decision() refuses (SQLSTATEs from migration 37), and what the Safety Officer is told. */
const DECISION_REFUSALS: Record<string, { status: number; error: string }> = {
  SC002: { status: 409, error: "This event isn't waiting for a safety check." }, // not ready, or already decided
  P0002: { status: 404, error: "Event not found." },
};

/**
 * SCRUM-99 (docs/specs/operational-safety-check.md): the Safety Officer's Operational Safety Check. Each route calls a
 * database function from migration 37 as the caller, so the database decides what is ready and what may be saved.
 */
export function safetyCheckRoutes(deps: SupabaseDeps) {
  const router = Router();
  router.use(requireSession(deps), requireSafetyOfficer(deps));

  // AC2: the events ready for a safety check (safety_check_queue())
  router.get("/", async (_req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data, error } = await deps.forUser(token).rpc("safety_check_queue");
    if (error) {
      console.error("safety_check_queue failed:", error.message);
      return res.status(500).json({ error: "We couldn't load the events waiting for a safety check. Please try again." });
    }
    return res.json(data ?? []);
  });

  // AC3: the information needed for the safety check of one event (safety_check_details())
  router.get("/:id", async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { data, error } = await deps.forUser(token).rpc("safety_check_details", { p_event_id: req.params.id });
    if (error) {
      console.error("safety_check_details failed:", error.message);
      return res.status(500).json({ error: "We couldn't load this event's safety information. Please try again." });
    }
    if (!data) return res.status(404).json({ error: "Event not found." });
    return res.json(data);
  });

  // AC4 + AC5 + AC8: save the Safety Officer's decision (record_safety_decision() records who, what, when and why)
  router.post("/:id/decision", async (req, res) => {
    const { token } = res.locals.user as SessionUser;
    const { decision, reason } = req.body;
    // AC4 + AC6: checked here first so the Safety Officer gets a clear message; the database checks again
    const problem = safetyDecisionProblem({ decision, reason });
    if (problem) return res.status(400).json({ error: problem });
    // AC8: the reason or comments, where given; a blank Approve comment is saved as none
    const trimmed = typeof reason === "string" ? reason.trim() : "";
    const { data, error } = await deps
      .forUser(token)
      .rpc("record_safety_decision", { p_event_id: req.params.id, p_decision: decision, p_reason: trimmed || null });
    if (error) {
      const refusal = error.code ? DECISION_REFUSALS[error.code] : undefined;
      if (refusal) return res.status(refusal.status).json({ error: refusal.error });
      console.error("record_safety_decision failed:", error.message);
      return res.status(500).json({ error: "We couldn't save your decision. Please try again." });
    }
    // record_safety_decision() returns a table, so PostgREST sends its one row in an array
    const [row] = data as { decision: SafetyDecision }[];
    return res.status(201).json({ ...row, label: SAFETY_DECISION_LABELS[row.decision] });
  });

  return router;
}
