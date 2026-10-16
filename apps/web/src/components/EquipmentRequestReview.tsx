"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  EQUIPMENT_REQUEST_REASON_MAX_LENGTH,
  EQUIPMENT_REQUEST_REVIEW_STATUSES,
  EQUIPMENT_REQUEST_STATUS_LABELS,
  parseEquipmentRequestReviewInput,
  type EquipmentRequestReviewStatus,
} from "@spm-t5/shared";
import { reviewEquipmentRequest, type EquipmentRequestDetailView } from "@/lib/equipmentRequests";

// SCRUM-87/AC4: Technical Support Staff move a waiting request to Under Review, Arranged or Cannot Fulfil.
// AC5: Cannot Fulfil asks for a reason. Validation is the shared parseEquipmentRequestReviewInput, so the form and
// equipment-service agree. Shown only while the request can be changed; the server checks again, so a stale screen
// just gets a clear refusal (for example, too few units free to mark it Arranged).
export function EquipmentRequestReview({ request }: { request: Pick<EquipmentRequestDetailView, "id" | "status" | "canReview"> }) {
  const router = useRouter();
  const [status, setStatus] = useState<EquipmentRequestReviewStatus | "">("");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  if (!request.canReview) return null;
  // Moving a request to the status it already has changes nothing, so that choice is not offered.
  const choices = EQUIPMENT_REQUEST_REVIEW_STATUSES.filter((s) => s !== request.status);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);

    const parsed = parseEquipmentRequestReviewInput({ status, reason });
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    const { ok, data } = await reviewEquipmentRequest(request.id, { status: parsed.data.status, reason });
    setSaving(false);
    if (ok) {
      setStatus("");
      setReason("");
      router.refresh();
      return;
    }
    if (data.fieldErrors) setFieldErrors(data.fieldErrors);
    setError(data.error ?? "We couldn't save the status. Please try again.");
  }

  return (
    <section className="vb__actions">
      <h2>Update status</h2>
      {error && <div className="alert alert--error" role="alert">{error}</div>}

      <form className="event__form" onSubmit={onSubmit} noValidate>
        <div className={`field${fieldErrors.status ? " field--error" : ""}`}>
          <label htmlFor="review-status">New status</label>
          <select
            id="review-status"
            value={status}
            aria-invalid={fieldErrors.status ? true : undefined}
            aria-describedby={fieldErrors.status ? "review-status-error" : undefined}
            onChange={(e) => setStatus(e.target.value as EquipmentRequestReviewStatus | "")}
          >
            <option value="">Choose the new status</option>
            {choices.map((s) => (
              <option key={s} value={s}>{EQUIPMENT_REQUEST_STATUS_LABELS[s]}</option>
            ))}
          </select>
          {fieldErrors.status && <p id="review-status-error" className="field__error">{fieldErrors.status}</p>}
        </div>

        {status === "CANNOT_FULFIL" && (
          <div className={`field${fieldErrors.reason ? " field--error" : ""}`}>
            <label htmlFor="review-reason">Why it cannot be fulfilled</label>
            <textarea
              id="review-reason"
              rows={4}
              value={reason}
              aria-invalid={fieldErrors.reason ? true : undefined}
              aria-describedby="review-reason-count"
              onChange={(e) => setReason(e.target.value)}
            />
            <span id="review-reason-count" className="field__hint">
              {reason.trim().length}/{EQUIPMENT_REQUEST_REASON_MAX_LENGTH}. The Event Coordinator will see this.
            </span>
            {fieldErrors.reason && <p className="field__error" role="alert">{fieldErrors.reason}</p>}
          </div>
        )}

        <button className="btn" type="submit" disabled={saving}>{saving ? "Saving…" : "Save status"}</button>
      </form>
    </section>
  );
}
