import { SAFETY_DECISION_LABELS, type SafetyDecision } from "@spm-t5/shared";
import { EmptyNote, EventSection } from "@/components/event/EventSection";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatSgt } from "@/lib/bookingQueue";
import type { SafetyDecisionRecord } from "@/lib/safetyCheckServer";
import type { StatusTone } from "@/lib/status";

/** SCRUM-142/AC7: how each decision looks as a status: icon, label and a tone that is not the button colour. */
const DECISION_TONES: Record<SafetyDecision, StatusTone> = { approved: "success", rejected: "danger", changes_requested: "warning" };

/** SCRUM-100/AC7 + AC8: the decisions, newest first, each with its badge, who made it and when, and the reason or comments. */
export function SafetyDecisionList({ decisions }: { decisions: SafetyDecisionRecord[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {decisions.map((d) => {
        const decision = d.decision as SafetyDecision;
        return (
          <li key={d.decided_at} className="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm">
            <StatusBadge tone={DECISION_TONES[decision] ?? "neutral"} label={SAFETY_DECISION_LABELS[decision] ?? d.decision} className="self-start" />
            <p className="font-semibold">
              {`${SAFETY_DECISION_LABELS[decision] ?? d.decision} by ${d.officer_name} on ${formatSgt(d.decided_at)}`}
            </p>
            {d.reason && <p className="whitespace-pre-line">{d.reason}</p>}
            {/* AC9 */}
            {d.revoked_at && <p className="text-muted-foreground">{`No longer applies: an important change was made on ${formatSgt(d.revoked_at)}.`}</p>}
          </li>
        );
      })}
    </ol>
  );
}

// SCRUM-100/AC7 + AC8: the Safety Officer's decisions (changes requested, approved, rejected), by whom and when, with the
// reason or comments, newest first. Shown to the event's coordinator and organiser; no section when the viewer may not see it (null). SCRUM-127: with none yet, the Safety tab says so.
export function EventSafetyDecisions({ decisions }: { decisions: SafetyDecisionRecord[] | null }) {
  if (!decisions) return null;
  return (
    <EventSection id="safety-decisions-heading" title="Safety check">
      {decisions.length === 0 ? <EmptyNote>No safety decision has been made on this event yet.</EmptyNote> : <SafetyDecisionList decisions={decisions} />}
    </EventSection>
  );
}
