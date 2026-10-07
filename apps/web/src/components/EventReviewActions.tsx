"use client";

import { useState } from "react";
import { canDecideEvent } from "@spm-t5/shared";
import { approveEvent, rejectEvent } from "@/lib/events";

type Step = "idle" | "approve" | "reason" | "reject";

interface Props {
  eventId: string;
  status: string;
  /** SCRUM-24/AC5: from event-service; false hides the actions entirely. */
  canReview: boolean;
  /** Called with the new status once event-service has saved the decision. */
  onDecided: (status: string) => void;
}

// SCRUM-24: a coordinator approves or rejects a request awaiting a decision, each after a confirm step (AC3).
// Rejecting needs a reason first (AC2). The server checks the status again, so a stale screen gets a clear refusal.
export function EventReviewActions({ eventId, status, canReview, onDecided }: Props) {
  const [step, setStep] = useState<Step>("idle");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!canReview || !canDecideEvent(status)) return null;

  const trimmed = reason.trim();

  async function run(action: () => ReturnType<typeof approveEvent>) {
    setBusy(true);
    setError(undefined);
    const { ok, data } = await action();
    if (ok) {
      setStep("idle");
      setReason("");
      onDecided(data.status);
    } else {
      setError(data.error ?? "We couldn't save your decision. Please try again.");
    }
    setBusy(false);
  }

  function checkReason() {
    if (trimmed) {
      setReasonError(undefined);
      setStep("reject");
    } else {
      setReasonError("Enter a reason for rejecting this request.");
    }
  }

  return (
    <section className="event-section" aria-labelledby="decision-heading">
      <h2 id="decision-heading">Decision</h2>
      {error && <div className="alert alert--error" role="alert">{error}</div>}

      <div className="event-detail-card">
        {step === "idle" && (
          <>
            <p>Review the request details below, then record your decision.</p>
            <div className="event-buttons">
              <button className="btn" type="button" onClick={() => setStep("approve")}>Approve request</button>
              <button className="btn btn--secondary" type="button" onClick={() => setStep("reason")}>Reject request</button>
            </div>
          </>
        )}

        {step === "approve" && (
          <div role="alertdialog" aria-label="Confirm approval">
            <p>Approve this request? The organiser will see that it has been approved.</p>
            <div className="event-buttons">
              <button className="btn" type="button" disabled={busy} onClick={() => run(() => approveEvent(eventId))}>
                {busy ? "Approving…" : "Yes, approve"}
              </button>
              <button className="btn btn--secondary" type="button" disabled={busy} onClick={() => setStep("idle")}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === "reason" && (
          <div className="field">
            <label htmlFor="event-rejection-reason">Reason for rejection</label>
            <textarea
              id="event-rejection-reason"
              rows={4}
              value={reason}
              aria-invalid={reasonError ? true : undefined}
              onChange={(e) => setReason(e.target.value)}
            />
            {reasonError && <p className="field__error" role="alert">{reasonError}</p>}
            <div className="event-buttons">
              <button className="btn" type="button" onClick={checkReason}>Continue</button>
              <button className="btn btn--secondary" type="button" onClick={() => { setStep("idle"); setReasonError(undefined); }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {step === "reject" && (
          <div role="alertdialog" aria-label="Confirm rejection">
            <p>Reject this request? The organiser will see this reason:</p>
            <blockquote className="event-quote">{trimmed}</blockquote>
            <div className="event-buttons">
              <button className="btn" type="button" disabled={busy} onClick={() => run(() => rejectEvent(eventId, trimmed))}>
                {busy ? "Rejecting…" : "Yes, reject"}
              </button>
              <button className="btn btn--secondary" type="button" disabled={busy} onClick={() => setStep("reason")}>
                Edit reason
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
