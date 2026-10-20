"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  EMPTY_VALUES, REVIEW_STEP, STEPS, firstStepWithError, toRequestBody, validateRequest, validateStep,
  type EventRequestFormValues,
} from "@/lib/eventRequestForm";
import { submitEventRequest, type RoomLayoutOption } from "@/lib/eventRequests";
import { RequestStepper } from "./RequestStepper";
import { ReviewStep } from "./ReviewStep";
import { StepFields } from "./StepFields";

// SCRUM-123: the step-by-step new event request. AC2: Continue is blocked by the current step's errors only. AC3: the
// Review step lists everything with Edit links. AC4: Submit sends it to event-service (SCRUM-49) and lands on the event page.
export function EventRequestForm({ layouts }: { layouts: RoomLayoutOption[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<EventRequestFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const change = (patch: Partial<EventRequestFormValues>) => setValues((v) => ({ ...v, ...patch }));

  function goTo(next: number) {
    setErrors({});
    setMessage(undefined);
    setStep(next);
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
    const { ok, data } = await submitEventRequest(toRequestBody(values));
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

        {last ? <ReviewStep values={values} layouts={layouts} onEdit={goTo} />
          : <StepFields step={step} values={values} errors={errors} layouts={layouts} onChange={change} />}

        <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-5">
          <Button type="button" variant="outline" disabled={step === 0 || submitting} onClick={() => goTo(step - 1)}>Back</Button>
          <Button type="submit" disabled={submitting}>
            {last ? (submitting ? "Submitting…" : "Submit request") : `Continue to ${STEPS[step + 1].label}`}
          </Button>
        </div>
      </form>
    </div>
  );
}
