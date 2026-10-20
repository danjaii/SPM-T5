import EventStatusBadge from "@/components/EventStatusBadge";
import { EmptyNote, EventSection } from "@/components/event/EventSection";
import type { ReviewDecision } from "@/lib/events";

// SCRUM-44/AC5: shown to the organiser while the request has no decision, so it never looks approved or rejected.
export const AWAITING_OUTCOME = "Your request is still being reviewed. The outcome will appear here once a coordinator approves or rejects it.";

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

interface Props {
  decision: ReviewDecision | null;
  /** Show the "still being reviewed" note when there's no decision (the organiser); coordinators have their own actions. */
  showAwaiting: boolean;
}

// SCRUM-44: the review outcome of an event request — approved or rejected (AC1, AC2), the coordinator's reason
// (AC3), and when and by whom it was decided (AC4). Server-rendered from GET /events/:id/outcome.
export function EventReviewOutcome({ decision, showAwaiting }: Props) {
  if (!decision && !showAwaiting) return null;

  return (
    <EventSection id="outcome-heading" title="Review outcome">
      {decision ? (
        <div className="flex flex-col gap-3">
          <p className="flex flex-wrap items-center gap-3">
            <EventStatusBadge status={decision.outcome} />
            <span className="text-sm text-muted-foreground">
              {formatDateTime(decision.decided_at)}
              {decision.decided_by_name && <> · by {decision.decided_by_name}</>}
            </span>
          </p>
          {decision.reason && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-fg-primary">{decision.outcome === "rejected" ? "Reason for rejection" : "Coordinator's comments"}</h3>
              <p className="text-sm">{decision.reason}</p>
            </div>
          )}
        </div>
      ) : (
        <EmptyNote role="status">{AWAITING_OUTCOME}</EmptyNote>
      )}
    </EventSection>
  );
}
