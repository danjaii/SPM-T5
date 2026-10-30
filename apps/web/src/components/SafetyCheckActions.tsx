"use client";

import { useState } from "react";
import { canMakeSafetyDecision, safetyDecisionProblem, type Role, type SafetyDecision } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Radio, RadioGroup } from "@/components/ui/radio-group";
import { TextareaField } from "@/components/ui/textarea-field";
import { formatSgt } from "@/lib/bookingQueue";
import { recordSafetyDecision, type RecordedSafetyDecision } from "@/lib/safetyCheck";
import { composeReason } from "@/lib/safetyFactors";

interface Props {
  /** SCRUM-99: the event being checked. */
  eventId: string;
  /** The signed-in user's role. */
  role: Role;
  /** SCRUM-142/AC3: the factors the Safety Officer flagged, whose notes go into the reason. */
  concerns?: { title: string; note: string }[];
}

/** SCRUM-99/AC4: the three outcomes, as they read, with what each one does (Figma "Your decision"). */
const OUTCOMES: { decision: SafetyDecision; label: string; help: string }[] = [
  { decision: "approved", label: "Approve", help: "Event moves on to Confirmed." },
  { decision: "changes_requested", label: "Request changes", help: "Returns to Planning. The arrangements you flag are reviewed again." },
  { decision: "rejected", label: "Reject", help: "Returns to Planning. The coordinator must re-plan." },
];

// SCRUM-116: only a Safety Officer is offered the decision. SCRUM-99: they choose an outcome (AC4), add a reason or
// comments (required to reject, AC6), and submit it. SCRUM-142/AC3: Submit decision is the confirmation, Reject is shown in
// the destructive style, and the notes on flagged factors are sent with the reason.
export function SafetyCheckActions({ eventId, role, concerns = [] }: Props) {
  const [decision, setDecision] = useState<SafetyDecision>();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [recorded, setRecorded] = useState<RecordedSafetyDecision>();

  // SCRUM-116/AC2: anyone who is not a Safety Officer is offered none of the decisions
  if (!canMakeSafetyDecision(role)) return null;

  async function submit() {
    // AC4 + AC6: the same rule event-service applies, so the Safety Officer hears about a missing reason straight away
    const reason = composeReason(note, concerns);
    const problem = safetyDecisionProblem({ decision, reason });
    setError(problem);
    if (problem || !decision) return;

    const { ok, data } = await recordSafetyDecision(eventId, decision, reason);
    if (ok) setRecorded(data);
    else setError(data.error ?? "We couldn't save your decision. Please try again.");
  }

  // AC5: once saved, the outcome replaces the choices
  if (recorded) {
    return (
      <Card className="gap-3 p-6" aria-labelledby="safety-check-heading">
        <h2 id="safety-check-heading" className="text-lg font-bold">Your decision</h2>
        {/* AC8: what was recorded: the decision, the Safety Officer, the date and time, and any reason or comments */}
        <AuthAlert tone="ok">{`Decision recorded: ${recorded.label}, by ${recorded.officer_name} on ${formatSgt(recorded.decided_at)}`}</AuthAlert>
        {recorded.reason && <p className="text-sm whitespace-pre-line">{recorded.reason}</p>}
      </Card>
    );
  }

  return (
    <Card className="gap-4 p-6" aria-labelledby="safety-check-heading">
      <h2 id="safety-check-heading" className="text-lg font-bold">Your decision</h2>
      {error && <AuthAlert tone="error">{error}</AuthAlert>}
      <RadioGroup aria-label="Decision" value={decision ?? ""} onValueChange={(value) => setDecision(value as SafetyDecision)}>
        {OUTCOMES.map((o) => (
          <label
            key={o.decision}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-strong p-3 has-data-checked:border-primary has-data-checked:bg-accent has-focus-visible:ring-2 has-focus-visible:ring-ring"
          >
            <Radio value={o.decision} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{o.label}</span>
              <span className="text-xs text-muted-foreground">{o.help}</span>
            </span>
          </label>
        ))}
      </RadioGroup>

      {decision && (
        <TextareaField
          id="safety-reason"
          label={decision === "approved" ? "Comments (optional)" : "Reason or comments"}
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}

      {decision === "changes_requested" && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Send back to</span>
          <p className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">Planning · venue and equipment</p>
        </div>
      )}

      <Button type="button" size="lg" variant={decision === "rejected" ? "destructive" : "default"} onClick={submit}>
        Submit decision
      </Button>
    </Card>
  );
}
