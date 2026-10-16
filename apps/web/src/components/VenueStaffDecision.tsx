"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseRejectionInput, REJECTION_REASON_MAX_LENGTH, type VenueBookingStatus } from "@spm-t5/shared";
import { approveVenueBooking, decisionActions, rejectVenueBooking } from "@/lib/venueBookings";

type Step = "idle" | "approve" | "reason" | "reject";

// SCRUM-38 / SCRUM-39: Venue Staff approve or reject a pending request, each after a confirm step. Shown only
// while it is PENDING; the server checks again, so a stale screen just gets a clear refusal (NOT_PENDING,
// SLOT_IN_PAST). The reject form validates with the same schema as the API (39-S2).
export function VenueStaffDecision({ booking }: { booking: { id: string; status: VenueBookingStatus | undefined; flagged?: boolean } }) {
  const router = useRouter();
  const allowed = decisionActions(booking.status, booking.flagged);
  const [step, setStep] = useState<Step>("idle");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!allowed.approve && !allowed.reject) return null;

  async function run(action: () => ReturnType<typeof approveVenueBooking>) {
    setBusy(true);
    setError(undefined);
    const { ok, data } = await action();
    if (ok) {
      setStep("idle");
      router.refresh();
    } else {
      setError(data.fieldErrors?.reason ?? data.error ?? "We couldn't complete that. Please try again.");
    }
    setBusy(false);
  }

  function checkReason() {
    const parsed = parseRejectionInput({ reason });
    if (parsed.ok) {
      setReasonError(undefined);
      setStep("reject");
    } else {
      setReasonError(parsed.fieldErrors.reason);
    }
  }

  const trimmed = reason.trim();

  return (
    <section className="vb__actions">
      <h2>Decision</h2>
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      {/* SCRUM-104/AC4: Approve is not offered for a flagged request; say why, and that rejecting is still possible */}
      {booking.flagged && !allowed.approve && (
        <p>This request is flagged, so it cannot be approved until the conflict is resolved. You can still reject it.</p>
      )}

      {step === "idle" && (
        <p>
          {allowed.approve && (
            <button className="btn" type="button" onClick={() => setStep("approve")}>Approve request</button>
          )}{" "}
          {allowed.reject && (
            <button className="btn btn--secondary" type="button" onClick={() => setStep("reason")}>Reject request</button>
          )}
        </p>
      )}

      {step === "approve" && (
        <div role="alertdialog" aria-label="Confirm approval">
          <p>Approve this request? The venue is committed to the event for the requested period.</p>
          <button className="btn" type="button" disabled={busy} onClick={() => run(() => approveVenueBooking(booking.id))}>
            {busy ? "Approving…" : "Yes, approve"}
          </button>{" "}
          <button className="btn btn--secondary" type="button" disabled={busy} onClick={() => setStep("idle")}>
            Cancel
          </button>
        </div>
      )}

      {step === "reason" && (
        <div className="field">
          <label htmlFor="rejection-reason">Reason for rejection</label>
          <textarea
            id="rejection-reason"
            rows={4}
            value={reason}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby="rejection-reason-count"
            onChange={(e) => setReason(e.target.value)}
          />
          <span id="rejection-reason-count" className="field__hint">{trimmed.length}/{REJECTION_REASON_MAX_LENGTH}</span>
          {reasonError && <p className="field__error" role="alert">{reasonError}</p>}
          <p>
            <button className="btn" type="button" onClick={checkReason}>Continue</button>{" "}
            <button className="btn btn--secondary" type="button" onClick={() => { setStep("idle"); setReasonError(undefined); }}>
              Cancel
            </button>
          </p>
        </div>
      )}

      {step === "reject" && (
        <div role="alertdialog" aria-label="Confirm rejection">
          <p>Reject this request? Rejections are final. The Coordinator will see this reason:</p>
          <blockquote>{trimmed}</blockquote>
          <button className="btn" type="button" disabled={busy} onClick={() => run(() => rejectVenueBooking(booking.id, trimmed))}>
            {busy ? "Rejecting…" : "Yes, reject"}
          </button>{" "}
          <button className="btn btn--secondary" type="button" disabled={busy} onClick={() => setStep("reason")}>
            Edit reason
          </button>
        </div>
      )}
    </section>
  );
}
