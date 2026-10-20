"use client";

import { useState } from "react";
import { canDecideEvent } from "@spm-t5/shared";
import { EventSection } from "@/components/event/EventSection";
import { InlineMessage } from "@/components/event/InlineMessage";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
    <EventSection id="decision-heading" title="Decision">
      {error && <InlineMessage kind="error">{error}</InlineMessage>}

      {step === "idle" && (
        <>
          <p className="text-sm text-muted-foreground">Review the request details below, then record your decision.</p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={() => setStep("approve")}>Approve request</Button>
            <Button type="button" variant="destructive" onClick={() => setStep("reason")}>Reject request</Button>
          </div>
        </>
      )}

      {step === "approve" && (
        <div role="alertdialog" aria-label="Confirm approval" className="flex flex-col gap-3">
          <p className="text-sm font-medium">Approve this request?</p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" disabled={busy} onClick={() => run(() => approveEvent(eventId))}>
              {busy ? "Approving…" : "Yes, approve"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setStep("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === "reason" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="event-rejection-reason" className="text-sm font-semibold">Reason for rejection</label>
          <Textarea
            id="event-rejection-reason"
            rows={4}
            value={reason}
            aria-invalid={reasonError ? true : undefined}
            onChange={(e) => setReason(e.target.value)}
          />
          {reasonError && <p className="text-sm font-medium text-destructive" role="alert">{reasonError}</p>}
          <div className="mt-2 flex flex-wrap gap-3">
            <Button type="button" onClick={checkReason}>Continue</Button>
            <Button type="button" variant="outline" onClick={() => { setStep("idle"); setReasonError(undefined); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === "reject" && (
        <div role="alertdialog" aria-label="Confirm rejection" className="flex flex-col gap-3">
          <p className="text-sm font-medium">Reject this request?</p>
          <blockquote className="whitespace-pre-wrap rounded-lg border-l-4 border-border-strong bg-muted px-4 py-3 text-sm">{trimmed}</blockquote>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="destructive" disabled={busy} onClick={() => run(() => rejectEvent(eventId, trimmed))}>
              {busy ? "Rejecting…" : "Yes, reject"}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setStep("reason")}>
              Edit reason
            </Button>
          </div>
        </div>
      )}
    </EventSection>
  );
}
