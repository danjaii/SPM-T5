"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parseVenueTimingInput } from "@spm-t5/shared";
import { putVenueTiming } from "@/lib/venueTiming";
import { Field } from "./Field";

type Errors = { setupMinutes?: string; turnaroundMinutes?: string };

// SCRUM-101: Venue Staff set a venue's setup and turnaround times. Shown only to them (the server says so with
// can_edit_timing, and checks again). Validates with the same parser as venue-service, so a bad value never leaves
// the browser and the saved values stay as they were (101-S3).
export function VenueTimingForm({ venueId, setupMinutes, turnaroundMinutes }: { venueId: string; setupMinutes: number; turnaroundMinutes: number }) {
  const router = useRouter();
  const [setup, setSetup] = useState(String(setupMinutes));
  const [turnaround, setTurnaround] = useState(String(turnaroundMinutes));
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    setFailure(undefined);

    const parsed = parseVenueTimingInput({ setupMinutes: setup, turnaroundMinutes: turnaround });
    if (!parsed.ok) {
      setErrors(parsed.fieldErrors);
      return;
    }
    setErrors({});

    setBusy(true);
    const { ok, data } = await putVenueTiming(venueId, parsed.data);
    setBusy(false);
    if (ok) {
      setSaved(true);
      router.refresh();
    } else if (data.fieldErrors) {
      setErrors(data.fieldErrors);
    } else {
      setFailure(data.error ?? "We couldn't save the times. Please try again.");
    }
  }

  return (
    <form className="profile-form" onSubmit={onSubmit} noValidate aria-label="Setup and turnaround times">
      <h2>Edit setup and turnaround times</h2>
      {failure && <div className="alert alert--error" role="alert">{failure}</div>}
      {saved && <div className="alert alert--ok" role="status">The times were saved.</div>}
      <Field
        id="setupMinutes"
        label="Setup time (minutes)"
        type="text"
        inputMode="numeric"
        value={setup}
        onChange={(e) => setSetup(e.target.value)}
        error={errors.setupMinutes}
        hint="Time the venue team needs before an event."
      />
      <Field
        id="turnaroundMinutes"
        label="Turnaround time (minutes)"
        type="text"
        inputMode="numeric"
        value={turnaround}
        onChange={(e) => setTurnaround(e.target.value)}
        error={errors.turnaroundMinutes}
        hint="Time the venue team needs after an event."
      />
      <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Save times"}</button>
    </form>
  );
}
