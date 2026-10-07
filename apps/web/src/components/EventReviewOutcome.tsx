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
    <section className="event-section" aria-labelledby="outcome-heading">
      <h2 id="outcome-heading">Review outcome</h2>
      {decision ? (
        <div className="event-detail-card">
          <p className="outcome">
            <span className={`outcome-badge outcome-badge--${decision.outcome}`}>
              {decision.outcome === "approved" ? "Approved" : "Rejected"}
            </span>
            <span className="outcome__when">
              {formatDateTime(decision.decided_at)}
              {decision.decided_by_name && <> · by {decision.decided_by_name}</>}
            </span>
          </p>
          {decision.reason && (
            <div className="outcome__reason">
              <h3>{decision.outcome === "rejected" ? "Reason for rejection" : "Coordinator's comments"}</h3>
              <p>{decision.reason}</p>
            </div>
          )}
        </div>
      ) : (
        <p className="event-detail-card event-detail-card--quiet" role="status">{AWAITING_OUTCOME}</p>
      )}
    </section>
  );
}
