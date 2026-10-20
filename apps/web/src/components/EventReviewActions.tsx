"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { canDecideEvent } from "@spm-t5/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TextareaField } from "@/components/ui/textarea-field";
import { addEventComment, approveEvent, rejectEvent } from "@/lib/events";

type Action = "approve" | "reject" | "clarify";

interface Props {
  eventId: string;
  status: string;
  /** SCRUM-24/AC5: from event-service; false hides the actions entirely. */
  canReview: boolean;
  /** Called with the new status once event-service has saved the decision. */
  onDecided: (status: string) => void;
}

// What each dialog says and asks for. Reject and clarify need text (SCRUM-125/AC2, AC3); approve only confirms.
const DIALOGS: Record<Action, { title: string; description: string; confirm: string; busy: string; field?: { label: string; missing: string } }> = {
  approve: {
    title: "Approve this request?",
    description: "The organiser is told that the request was approved.",
    confirm: "Approve request",
    busy: "Approving…",
  },
  reject: {
    title: "Reject this request?",
    description: "The organiser sees your reason with the rejection. This can't be undone.",
    confirm: "Reject request",
    busy: "Rejecting…",
    field: { label: "Reason for rejection", missing: "Enter a reason for rejecting this request." },
  },
  clarify: {
    title: "Request clarification",
    description: "Your question is posted to the event conversation and the organiser is notified. The request stays under review.",
    confirm: "Send question",
    busy: "Sending…",
    field: { label: "Your question for the organiser", missing: "Enter the question you want the organiser to answer." },
  },
};

// SCRUM-24: a coordinator approves or rejects a request awaiting a decision. SCRUM-47: or asks the organiser to clarify it.
// SCRUM-125/AC1: the three actions sit together in one row; each opens a dialog (AC2: reject is destructive and needs a
// reason). The server checks the status again, so a stale screen gets a clear refusal inside the dialog.
export function EventReviewActions({ eventId, status, canReview, onDecided }: Props) {
  const router = useRouter();
  const [action, setAction] = useState<Action | null>(null);
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!canReview || !canDecideEvent(status)) return null;

  function open(next: Action) {
    setText("");
    setTextError(undefined);
    setError(undefined);
    setAction(next);
  }

  async function confirm() {
    if (!action) return;
    const trimmed = text.trim();
    const { field } = DIALOGS[action];
    if (field && !trimmed) {
      setTextError(field.missing);
      return;
    }
    setBusy(true);
    setError(undefined);
    const { ok, data } =
      action === "approve"
        ? await approveEvent(eventId)
        : action === "reject"
          ? await rejectEvent(eventId, trimmed)
          : await addEventComment(eventId, trimmed, undefined, [], true);
    if (ok) {
      setAction(null);
      if (action === "clarify") toast.success("Your question was sent to the organiser.");
      else onDecided((data as { status: string }).status);
      router.refresh(); // so the outcome and the conversation show what was just saved
    } else {
      setError(
        (data as { error?: string }).error ??
          (action === "clarify" ? "We couldn't send your question. Please try again." : "We couldn't save your decision. Please try again."),
      );
    }
    setBusy(false);
  }

  const dialog = action ? DIALOGS[action] : null;

  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Review this request">
        <Button variant="outline" onClick={() => open("clarify")}>Request clarification</Button>
        <Button variant="destructive" onClick={() => open("reject")}>Reject</Button>
        <Button onClick={() => open("approve")}>Approve request</Button>
      </div>

      <Dialog open={action !== null} onOpenChange={(isOpen) => { if (!isOpen && !busy) setAction(null); }}>
        {dialog && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dialog.title}</DialogTitle>
              <DialogDescription>{dialog.description}</DialogDescription>
            </DialogHeader>
            {dialog.field && (
              <TextareaField
                id="review-dialog-text"
                label={dialog.field.label}
                rows={4}
                value={text}
                error={textError}
                onChange={(e) => setText(e.target.value)}
              />
            )}
            {error && (
              <p role="alert" className="flex items-center gap-1.5 rounded-lg bg-status-danger px-3 py-2 text-sm font-medium text-status-danger-fg">
                <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => setAction(null)}>Cancel</Button>
              <Button variant={action === "reject" ? "destructive" : "default"} disabled={busy} onClick={confirm}>
                {busy ? dialog.busy : dialog.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
