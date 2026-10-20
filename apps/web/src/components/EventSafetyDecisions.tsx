import { SAFETY_DECISION_LABELS, type SafetyDecision } from "@spm-t5/shared";
import { EmptyNote, EventSection } from "@/components/event/EventSection";
import { formatSgt } from "@/lib/bookingQueue";
import type { SafetyDecisionRecord } from "@/lib/safetyCheckServer";

// SCRUM-100/AC7 + AC8: the Safety Officer's decisions (changes requested, approved, rejected), by whom and when, with the
// reason or comments, newest first. Shown to the event's coordinator and organiser; no section when the viewer may not see it (null). SCRUM-127: with none yet, the Safety tab says so.
export function EventSafetyDecisions({ decisions }: { decisions: SafetyDecisionRecord[] | null }) {
  if (!decisions) return null;
  return (
    <EventSection id="safety-decisions-heading" title="Safety check">
      {decisions.length === 0 ? (
        <EmptyNote>No safety decision has been made on this event yet.</EmptyNote>
      ) : (
        <ol className="flex flex-col gap-3">
          {decisions.map((d) => (
            <li key={d.decided_at} className="flex flex-col gap-1 rounded-lg border border-border p-4 text-sm">
              <p className="font-semibold">
                {`${SAFETY_DECISION_LABELS[d.decision as SafetyDecision] ?? d.decision} by ${d.officer_name} on ${formatSgt(d.decided_at)}`}
              </p>
              {d.reason && <p>{d.reason}</p>}
              {/* AC9 */}
              {d.revoked_at && <p className="text-muted-foreground">{`No longer applies: an important change was made on ${formatSgt(d.revoked_at)}.`}</p>}
            </li>
          ))}
        </ol>
      )}
    </EventSection>
  );
}
