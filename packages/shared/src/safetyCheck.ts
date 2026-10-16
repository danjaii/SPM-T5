// SCRUM-99 (docs/specs/operational-safety-check.md): the Operational Safety Check rules, shared so apps/web and
// event-service validate a decision the same way.

/** AC4: the outcomes a Safety Officer can choose. Must match the safety_decision enum (migration 37). */
export const SAFETY_DECISIONS = ["approved", "rejected", "changes_requested"] as const;
export type SafetyDecision = (typeof SAFETY_DECISIONS)[number];

/** AC5: how each decision reads. An approved event is "Safety Approved". */
export const SAFETY_DECISION_LABELS: Record<SafetyDecision, string> = {
  approved: "Safety Approved",
  rejected: "Safety Rejected",
  changes_requested: "Changes Requested",
};

/** What is wrong with a safety decision, or undefined when it can be saved. */
export function safetyDecisionProblem({ decision, reason }: { decision: unknown; reason: unknown }): string | undefined {
  // AC4: only Approve, Reject or Request Changes
  if (!(SAFETY_DECISIONS as readonly unknown[]).includes(decision)) return "Choose Approve, Reject or Request Changes.";
  const hasReason = typeof reason === "string" && reason.trim() !== "";
  // AC6: a rejection must say why
  if (decision === "rejected" && !hasReason) return "Give a reason for rejecting this event.";
  // Spec decision: a change request must say what to change
  if (decision === "changes_requested" && !hasReason) return "Say what needs to change.";
  return undefined;
}

/**
 * AC5 + AC7: an event may move to preparation (confirmed) only when its latest safety decision is Approve. Null means it
 * has not been checked yet. The database's events_safety_gate trigger (migration 37) enforces the same rule.
 */
export function canProceedToPreparation(latestDecision: SafetyDecision | null): boolean {
  return latestDecision === "approved";
}
