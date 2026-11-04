import { EventSection } from "@/components/event/EventSection";
import { SafetyDecisionList } from "@/components/EventSafetyDecisions";
import type { SafetyDecisionRecord } from "@/lib/safetyCheckServer";

// SCRUM-99/AC8: the recorded safety decisions, newest first: the decision, the Safety Officer, the date and time, and
// any reason or comments. SCRUM-142: the same list the event page's Safety tab shows.
export function SafetyDecisionHistory({ decisions }: { decisions: SafetyDecisionRecord[] }) {
  return (
    <EventSection id="safety-decision-heading" title="Safety decision">
      <SafetyDecisionList decisions={decisions} />
    </EventSection>
  );
}
