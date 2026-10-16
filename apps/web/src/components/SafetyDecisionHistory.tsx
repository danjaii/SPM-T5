import { SAFETY_DECISION_LABELS, type SafetyDecision } from "@spm-t5/shared";
import { formatSgt } from "@/lib/bookingQueue";
import type { SafetyDecisionRecord } from "@/lib/safetyCheckServer";

// SCRUM-99/AC8: the recorded safety decisions, newest first: the decision, the Safety Officer, the date and time, and
// any reason or comments.
export function SafetyDecisionHistory({ decisions }: { decisions: SafetyDecisionRecord[] }) {
  return (
    <section className="event-section" aria-labelledby="safety-decision-heading">
      <h2 id="safety-decision-heading">Safety decision</h2>
      <div className="event-detail-card">
        <ul>
          {decisions.map((d) => (
            <li key={d.decided_at}>
              <p>
                {`${SAFETY_DECISION_LABELS[d.decision as SafetyDecision] ?? d.decision} by ${d.officer_name} on ${formatSgt(d.decided_at)}`}
              </p>
              {d.reason && <p>{d.reason}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
