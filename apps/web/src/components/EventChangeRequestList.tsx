import Link from "next/link";
import { CHANGE_REQUEST_REVIEW_MESSAGES } from "@spm-t5/shared";
import type { ChangeRequestView } from "@/lib/events";

const STATUS_LABELS: Record<ChangeRequestView["status"], string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const formatRequestedAt = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Singapore" });

// SCRUM-66/AC7: each change request the organiser has made, with whether it is pending, approved or rejected.
// SCRUM-67/AC1: for the event's assigned coordinator (`reviewable`), a notice when one awaits their review, and a link to
// review each.
export function EventChangeRequestList({ requests, reviewable = false }: { requests: ChangeRequestView[]; reviewable?: boolean }) {
  return (
    <section className="event" aria-labelledby="change-requests">
      <h2 id="change-requests">Change requests</h2>
      {reviewable && requests.some((r) => r.status === "pending") && (
        <div className="alert alert--warning" role="status">
          {CHANGE_REQUEST_REVIEW_MESSAGES.awaitingReview}
        </div>
      )}
      {requests.length === 0 ? (
        <p className="field__hint">No change requests yet.</p>
      ) : (
        <ul className="vb__list">
          {requests.map((r) => (
            <li key={r.id}>
              <span className="status-badge">{STATUS_LABELS[r.status] ?? r.status}</span>{" "}
              {r.change_description} <span className="field__hint">({formatRequestedAt(r.requested_at)})</span>
              {reviewable && (
                <>
                  {" "}
                  <Link href={`/change-requests/${r.id}`}>Review</Link>
                </>
              )}
              {r.status === "rejected" && r.review_notes && <p className="field__hint">{r.review_notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
