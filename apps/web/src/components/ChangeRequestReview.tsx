"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CHANGE_REQUEST_REVIEW_MESSAGES, parseChangeRequestRejection } from "@spm-t5/shared";
import { formatSgt } from "@/lib/bookingQueue";
import { approveChangeRequest, rejectChangeRequest, type ChangeRequestReviewView } from "@/lib/changeRequestReview";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import { changeValue } from "./EventChangeHistory";

const KIND_LABELS = { venue_booking: "Venue booking", equipment_request: "Equipment request" } as const;

// SCRUM-67: the event's coordinator reviews an organiser's change request. Each requested change is shown with the current
// value (AC2); Approve and Reject each ask to confirm first, and Cancel leaves everything as it is (AC6). Approving lists
// the arrangements the change sends back for review (SCRUM-112/113); rejecting needs a reason (AC4). A decided request
// shows its outcome and offers nothing (AC8).
export function ChangeRequestReview({ review }: { review: ChangeRequestReviewView }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<"approve" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [saving, setSaving] = useState(false);

  function close() {
    setConfirming(null);
    setError(undefined);
  }

  async function confirm() {
    let result;
    if (confirming === "reject") {
      const parsed = parseChangeRequestRejection({ reason });
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      setSaving(true);
      result = await rejectChangeRequest(review.id, parsed.reason);
    } else {
      setSaving(true);
      result = await approveChangeRequest(review.id);
    }
    setSaving(false);
    if (!result.ok) {
      setError(result.data.fieldErrors?.reason ?? result.data.error ?? "We couldn't save the decision. Please try again.");
      return;
    }
    setConfirming(null);
    setDone(result.data.message);
    router.refresh();
  }

  const decided =
    review.status === "approved"
      ? `Approved on ${formatSgt(review.reviewedAt!)}`
      : review.status === "rejected"
        ? `Rejected on ${formatSgt(review.reviewedAt!)}: ${review.reviewNotes ?? ""}`
        : null;

  return (
    <section className="event">
      <h1>Change request for {review.eventName}</h1>
      <p className="event__status">
        Requested {formatSgt(review.requestedAt)} · <span className="status-badge">{review.status}</span>
      </p>
      <p>{review.changeDescription}</p>
      {decided && <p className="event__status">{decided}</p>}
      {done && (
        <div className="alert alert--ok" role="status">
          {done}
        </div>
      )}
      {review.status === "pending" && review.outdated && (
        <div className="alert alert--warning" role="alert">{CHANGE_REQUEST_REVIEW_MESSAGES.outdated}</div>
      )}
      {review.status === "pending" && review.unsupported.length > 0 && (
        <div className="alert alert--warning" role="alert">{CHANGE_REQUEST_REVIEW_MESSAGES.unsupported}</div>
      )}

      <table className="detail-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Current value</th>
            <th>Requested value</th>
          </tr>
        </thead>
        <tbody>
          {review.rows.map((r) => (
            <tr key={r.field}>
              <td>
                {r.label}
                {r.changedSince && <span className="field__hint field__hint--important"> Changed since the request</span>}
                {!r.supported && <span className="field__hint field__hint--important"> Can&apos;t be applied</span>}
              </td>
              <td>{changeValue(r.field, r.current)}</td>
              <td>{changeValue(r.field, r.requested)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {confirming === "approve" && (
        <section className="impact" role="region" aria-label="Confirm approval">
          <h2>Approve this change request?</h2>
          <p>The event will be updated to the requested values.</p>
          {review.affected.length > 0 && (
            <>
              <p>These arrangements may be affected and will be sent back for review:</p>
              <ul className="impact__list">
                {review.affected.map((a) => (
                  <li key={`${a.kind}-${a.id}`} className="impact__item">
                    <p className="impact__name">
                      {KIND_LABELS[a.kind]}: {a.name}
                    </p>
                    <p className="impact__meta">
                      {formatEventDateTime(a.start, a.end)} · {a.statusLabel}
                    </p>
                    <ul className="impact__reasons">
                      {a.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {confirming === "reject" && (
        <div className="field">
          <label htmlFor="reject-reason">Reason for rejecting</label>
          <textarea id="reject-reason" rows={3} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      {error && <p className="field__error">{error}</p>}

      {confirming ? (
        <div className="impact__actions">
          <button type="button" className="btn" onClick={confirm} disabled={saving}>
            {saving ? "Saving…" : confirming === "approve" ? "Confirm approval" : "Confirm rejection"}
          </button>
          <button type="button" className="btn btn--secondary" onClick={close} disabled={saving}>
            Cancel
          </button>
        </div>
      ) : (
        (review.canApprove || review.canReject) &&
        !done && (
          <div className="impact__actions">
            {review.canApprove && (
              <button type="button" className="btn" onClick={() => setConfirming("approve")}>
                Approve
              </button>
            )}
            {review.canReject && (
              <button type="button" className="btn btn--secondary" onClick={() => setConfirming("reject")}>
                Reject
              </button>
            )}
          </div>
        )
      )}
    </section>
  );
}
