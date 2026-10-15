"use client";

import { useState } from "react";
import { parseSuitabilityOverride, SUITABILITY_OVERRIDE_MAX_LENGTH, type UnmetRequirement } from "@spm-t5/shared";

interface Props {
  /** The requirements venue-service said are not met (409 UNSUITABLE_VENUE). */
  unmet: UnmetRequirement[];
  /** Called with the reason (trimmed, 1 to 500 characters) when the coordinator goes ahead anyway. */
  onConfirm: (reason: string) => void;
  /** Back to the form; nothing has been created. */
  onCancel: () => void;
  busy?: boolean;
}

// SCRUM-110/AC2, AC3: shown inline before a venue booking request is created when the venue does not suit it. The
// coordinator can go ahead only with a reason, or cancel. Same inline-confirm pattern as VenueStaffDecision.
export function UnsuitableConfirm({ unmet, onConfirm, onCancel, busy }: Props) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  function confirm() {
    const parsed = parseSuitabilityOverride({ overrideReason: reason });
    if (!parsed.ok) return setError(parsed.fieldErrors.overrideReason);
    if (parsed.data.reason === null) return setError("Enter a reason to continue.");
    setError(undefined);
    onConfirm(parsed.data.reason);
  }

  return (
    <div className="vb__confirm" role="alertdialog" aria-labelledby="unsuitable-title">
      <h2 id="unsuitable-title">This venue does not suit the event</h2>
      <ul>
        {unmet.map((u) => (
          <li key={u.key}>
            <strong>{u.label}:</strong> {u.message}
          </li>
        ))}
      </ul>
      <p>Venue staff will see these requirements and your reason with the request.</p>
      <div className={`field${error ? " field--error" : ""}`}>
        <label htmlFor="overrideReason">Reason for requesting it anyway</label>
        <textarea
          id="overrideReason"
          rows={3}
          maxLength={SUITABILITY_OVERRIDE_MAX_LENGTH}
          value={reason}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setReason(e.target.value)}
        />
        {error && <p className="field__error">{error}</p>}
      </div>
      <button className="btn" type="button" disabled={busy} onClick={confirm}>
        {busy ? "Submitting…" : "Submit anyway"}
      </button>{" "}
      <button className="btn btn--secondary" type="button" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}
