"use client";

import { useState } from "react";
import { canMakeSafetyDecision, safetyDecisionProblem, type Role, type SafetyDecision } from "@spm-t5/shared";
import { formatSgt } from "@/lib/bookingQueue";
import { recordSafetyDecision, type RecordedSafetyDecision } from "@/lib/safetyCheck";

interface Props {
  /** SCRUM-99: the event being checked. */
  eventId: string;
  /** The signed-in user's role. */
  role: Role;
}

/** SCRUM-99/AC4: the three outcomes, as their buttons read. */
const OUTCOMES: { decision: SafetyDecision; label: string }[] = [
  { decision: "approved", label: "Approve" },
  { decision: "rejected", label: "Reject" },
  { decision: "changes_requested", label: "Request changes" },
];

// SCRUM-116: only a Safety Officer is offered the decision. SCRUM-99: they choose an outcome (AC4), add a reason or
// comments (required to reject, AC6), and submit it.
export function SafetyCheckActions({ eventId, role }: Props) {
  const [decision, setDecision] = useState<SafetyDecision>();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [recorded, setRecorded] = useState<RecordedSafetyDecision>();

  // SCRUM-116/AC2: anyone who is not a Safety Officer is offered none of the decisions
  if (!canMakeSafetyDecision(role)) return null;

  async function submit() {
    // AC4 + AC6: the same rule event-service applies, so the Safety Officer hears about a missing reason straight away
    const problem = safetyDecisionProblem({ decision, reason });
    setError(problem);
    if (problem || !decision) return;

    const { ok, data } = await recordSafetyDecision(eventId, decision, reason);
    if (ok) setRecorded(data);
    else setError(data.error ?? "We couldn't save your decision. Please try again.");
  }

  // AC5: once saved, the outcome replaces the choices
  if (recorded) {
    return (
      <section className="event-section" aria-labelledby="safety-check-heading">
        <h2 id="safety-check-heading">Safety check</h2>
        {/* AC8: what was recorded: the decision, the Safety Officer, the date and time, and any reason or comments */}
        <div className="alert alert--ok" role="status">
          <p>{`Decision recorded: ${recorded.label}, by ${recorded.officer_name} on ${formatSgt(recorded.decided_at)}`}</p>
          {recorded.reason && <p>{recorded.reason}</p>}
        </div>
      </section>
    );
  }

  return (
    <section className="event-section" aria-labelledby="safety-check-heading">
      <h2 id="safety-check-heading">Safety check</h2>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      <div className="event-detail-card">
        <div className="event-buttons">
          {OUTCOMES.map((o) => (
            <button
              key={o.decision}
              // only the chosen outcome is filled; the others stay outlined
              className={decision === o.decision ? "btn" : "btn btn--secondary"}
              type="button"
              aria-pressed={decision === o.decision}
              onClick={() => setDecision(o.decision)}
            >
              {o.label}
            </button>
          ))}
        </div>

        {decision && (
          <>
            <div className="field">
              <label htmlFor="safety-reason">{decision === "approved" ? "Comments (optional)" : "Reason or comments"}</label>
              <textarea id="safety-reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <button className="btn" type="button" onClick={submit}>Submit decision</button>
          </>
        )}
      </div>
    </section>
  );
}
