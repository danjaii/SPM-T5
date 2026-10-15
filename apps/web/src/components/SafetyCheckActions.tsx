import { canMakeSafetyDecision, type Role } from "@spm-t5/shared";

interface Props {
  /** The signed-in user's role. */
  role: Role;
}

// SCRUM-116: the Safety Officer's decision on an event awaiting a safety check. Saving the decision belongs to the
// safety-check workflow story; this story only decides who is offered it.
export function SafetyCheckActions({ role }: Props) {
  // AC2: anyone who is not a Safety Officer is offered none of the decisions
  if (!canMakeSafetyDecision(role)) return null;

  return (
    <section className="event-section" aria-labelledby="safety-check-heading">
      <h2 id="safety-check-heading">Safety check</h2>
      <div className="event-detail-card">
        <div className="event-buttons">
          <button className="btn" type="button">Approve</button>
          <button className="btn btn--secondary" type="button">Reject</button>
          <button className="btn btn--secondary" type="button">Request changes</button>
        </div>
      </div>
    </section>
  );
}
