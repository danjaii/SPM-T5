"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseTechnicalAssignmentCancel } from "@spm-t5/shared";
import { cancelTechnicalAssignment } from "@/lib/technicalAssignments";

// SCRUM-20/AC3: the coordinator cancels an on-site assignment with a reason, which the technician is told.
export function TechnicalAssignmentCancel({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function confirm() {
    const parsed = parseTechnicalAssignmentCancel({ reason });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    const { ok, data } = await cancelTechnicalAssignment(assignmentId, parsed.reason);
    setSaving(false);
    if (!ok) {
      setError(data.fieldErrors?.reason ?? data.error ?? "We couldn't cancel the assignment. Please try again.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="btn btn--secondary" onClick={() => setOpen(true)}>
        Cancel assignment
      </button>
    );
  }

  const reasonId = `cancel-reason-${assignmentId}`;
  return (
    <div className="vb__cancel">
      <label htmlFor={reasonId}>Reason for cancelling</label>
      <textarea id={reasonId} rows={2} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      {error && <p className="field__error" role="alert">{error}</p>}
      <div className="event-buttons">
        <button type="button" className="btn" onClick={confirm} disabled={saving}>
          {saving ? "Cancelling…" : "Confirm cancel"}
        </button>
        <button
          type="button"
          className="btn btn--secondary"
          onClick={() => {
            setOpen(false);
            setError(undefined);
          }}
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
