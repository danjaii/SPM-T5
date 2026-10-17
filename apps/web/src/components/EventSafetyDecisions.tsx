import { SAFETY_DECISION_LABELS, type SafetyDecision } from "@spm-t5/shared";
import { formatSgt } from "@/lib/bookingQueue";
import type { SafetyDecisionRecord } from "@/lib/safetyCheckServer";

// SCRUM-100/AC7 + AC8: the Safety Officer's decisions (changes requested, approved, rejected), by whom and when, with the
// reason or comments, newest first. Shown to the event's coordinator and organiser; no section when there is nothing to
// show or the viewer may not see it (null).
export function EventSafetyDecisions({ decisions }: { decisions: SafetyDecisionRecord[] | null }) {
  if (!decisions || decisions.length === 0) return null;
  return (
    <section className="event-section" aria-labelledby="safety-decisions-heading">
      <h2 id="safety-decisions-heading">Safety check</h2>
      <ol className="change-history">
        {decisions.map((d) => (
          <li key={d.decided_at} className="event-detail-card">
            <p className="change-history__who">
              {`${SAFETY_DECISION_LABELS[d.decision as SafetyDecision] ?? d.decision} by ${d.officer_name} on ${formatSgt(d.decided_at)}`}
            </p>
            {d.reason && <p>{d.reason}</p>}
            {/* AC9 */}
            {d.revoked_at && <p>{`No longer applies: an important change was made on ${formatSgt(d.revoked_at)}.`}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
