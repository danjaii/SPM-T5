"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EMPTY_VALUES, REVIEW_STEP, STEPS, firstStepWithError, toDraftBody, toRequestBody, validateRequest, validateStep,
  type EventRequestFormValues,
} from "@/lib/eventRequestForm";
import { saveEventDraft, submitEventDraft, submitEventRequest, updateEventDraft, type RoomLayoutOption } from "@/lib/eventRequests";
import { RequestStepper } from "./RequestStepper";
import { ReviewStep } from "./ReviewStep";
import { StepFields } from "./StepFields";

// SCRUM-123: the step-by-step new event request. AC2: Continue is blocked by the current step's errors only. AC3: the
// Review step lists everything with Edit links. AC4: Submit sends it to event-service (SCRUM-49) and lands on the event page.
export function EventRequestForm({ layouts, draft }: { layouts: RoomLayoutOption[]; draft?: { id: string; values: EventRequestFormValues } }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<EventRequestFormValues>(draft?.values ?? EMPTY_VALUES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [saved, setSaved] = useState<string>();
  // SCRUM-54/AC2: the draft this form is editing: the one it was opened from, or the one its first Save as draft created.
  const [draftId, setDraftId] = useState(draft?.id);

  // The newest values, kept in step with every change as it happens: a select closes in the same event that picks its
  // option, before React re-renders, so onBlurField reads these rather than the `values` of the render it was made in.
  const latest = useRef(values);
  const change = (patch: Partial<EventRequestFormValues>) => {
    latest.current = { ...latest.current, ...patch };
    setValues(latest.current);
  };

  function goTo(next: number) {
    setErrors({});
    setMessage(undefined);
    setStep(next);
  }

  // SCRUM-49/AC3: flag a required field when the organiser leaves it. Only that field's error is touched, so fields not yet
  // visited stay quiet; the rule is the same shared one Continue uses, and a fixed field loses its error.
  function onBlurField(field: string) {
    const found = validateStep(step, latest.current);
    setErrors((current) => {
      const next = { ...current };
      if (field in found) next[field] = found[field];
      else delete next[field];
      return next;
    });
  }

  function onContinue() {
    const found = validateStep(step, values);
    setErrors(found);
    if (Object.keys(found).length === 0) goTo(step + 1);
  }

  async function onSubmit() {
    setMessage(undefined);
    const all = validateRequest(values);
    if (Object.keys(all).length > 0) {
      // something earlier is incomplete: take the organiser back to it with its errors showing
      const target = firstStepWithError(all);
      setStep(target);
      setErrors(validateStep(target, values));
      setMessage("Some details are missing or need correcting. We took you to the first one.");
      return;
    }

    setSubmitting(true);
    const body = toRequestBody(values);
    // SCRUM-54/AC3: a request that began as a draft is submitted as that draft, so it stays one request
    const { ok, data } = draftId ? await submitEventDraft(draftId, body) : await submitEventRequest(body);
    if (ok && data.id) {
      router.push(`/events/${data.id}?submitted=1`);
      return;
    }
    if (data.fieldErrors) {
      const target = firstStepWithError(data.fieldErrors);
      setStep(target);
      setErrors(data.fieldErrors);
    }
    setMessage(data.error ?? "We couldn't submit the request. Please try again.");
    setSubmitting(false);
  }

  // SCRUM-53/AC1: save whatever is filled in so far, on any step; none of the submission rules apply.
  async function onSaveDraft() {
    if (savingDraft) return;
    setMessage(undefined);
    setSaved(undefined);
    setSavingDraft(true);
    const body = toDraftBody(latest.current);
    const { ok, data } = draftId ? await updateEventDraft(draftId, body) : await saveEventDraft(body);
    setSavingDraft(false);
    if (ok && data.id) setDraftId(data.id);
    if (ok) setSaved("Draft saved. You can find it in My event requests.");
    else setMessage(data.error ?? "We couldn't save the draft. Please try again.");
  }

  const last = step === REVIEW_STEP;
  return (
    <div className="grid gap-6 md:grid-cols-[17.5rem_1fr]">
      <RequestStepper current={step} onGoTo={goTo} />

      <form noValidate onSubmit={(e) => { e.preventDefault(); if (last) void onSubmit(); else onContinue(); }}
        className="flex flex-col gap-6 rounded-xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
        <h2 className="text-xl font-bold text-foreground">{STEPS[step].label}</h2>

        {message ? (
          <p role="alert" className="flex items-center gap-2 rounded-lg bg-status-danger p-3 text-sm font-medium text-status-danger-fg">
            <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
            {message}
          </p>
        ) : null}

        {saved ? (
          <p role="status" className="rounded-lg bg-muted p-3 text-sm font-medium text-foreground">{saved}</p>
        ) : null}

        {last ? <ReviewStep values={values} layouts={layouts} onEdit={goTo} />
          : <StepFields step={step} values={values} errors={errors} layouts={layouts} onChange={change} onBlurField={onBlurField} />}

        <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-5">
          <Button type="button" variant="outline" disabled={step === 0 || submitting} onClick={() => goTo(step - 1)}>Back</Button>
          <Button type="button" variant="outline" disabled={savingDraft || submitting} onClick={() => void onSaveDraft()}>
            {savingDraft ? "Saving…" : "Save as draft"}
          </Button>
          <Button type="submit" disabled={submitting}>
            {last ? (submitting ? "Submitting…" : "Submit request") : `Continue to ${STEPS[step + 1].label}`}
          </Button>
        </div>
      </form>
    </div>
  );
}
