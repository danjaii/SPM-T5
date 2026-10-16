"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  formatShortSgt,
  parseUnavailabilityInput,
  SELECTABLE_UNAVAILABILITY_REASONS,
  UNAVAILABILITY_REASON_LABELS,
} from "@spm-t5/shared";
import { postVenueUnavailability } from "@/lib/venueUnavailability";
import { Field } from "./Field";

type Errors = Partial<Record<"startDate" | "startTime" | "endDate" | "endTime" | "reason" | "notes", string>>;

// SCRUM-105: Venue Staff mark a venue unavailable for a period with a reason. Shown only to them (the server says so with
// can_mark_unavailable, and checks again, and so does the database). It validates with the same parser as venue-service, so a
// missing reason (105-S2) or an end that is not after the start (105-S3) never leaves the browser and nothing is saved.
export function VenueUnavailabilityForm({ venueId }: { venueId: string }) {
  const router = useRouter();
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(undefined);
    setFailure(undefined);

    const parsed = parseUnavailabilityInput({ startDate, startTime, endDate, endTime, reason, notes });
    if (!parsed.ok) {
      setErrors(parsed.fieldErrors);
      return;
    }
    setErrors({});

    setBusy(true);
    const { ok, data } = await postVenueUnavailability(venueId, {
      startDate,
      startTime,
      endDate,
      endTime,
      reason: parsed.data.reason,
      ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
    });
    setBusy(false);
    if (ok) {
      setSaved(`Marked unavailable from ${formatShortSgt(parsed.data.start)} to ${formatShortSgt(parsed.data.end)}.`);
      setStartDate("");
      setStartTime("");
      setEndDate("");
      setEndTime("");
      setReason("");
      setNotes("");
      router.refresh();
    } else if (data.fieldErrors && !data.fieldErrors.form) {
      setErrors(data.fieldErrors);
    } else {
      setFailure(data.fieldErrors?.form ?? data.error ?? "We couldn't save the unavailability. Please try again.");
    }
  }

  return (
    <form className="profile-form" onSubmit={onSubmit} noValidate aria-label="Mark this venue unavailable">
      <h2>Mark this venue unavailable</h2>
      <p className="field__hint">Dates and times are Singapore time. New requests that overlap the period, including their setup and turnaround, are refused.</p>
      {failure && <div className="alert alert--error" role="alert">{failure}</div>}
      {saved && <div className="alert alert--ok" role="status">{saved}</div>}
      <Field id="unavailableStartDate" label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} error={errors.startDate} />
      <Field id="unavailableStartTime" label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} error={errors.startTime} />
      <Field id="unavailableEndDate" label="End date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} error={errors.endDate} />
      <Field id="unavailableEndTime" label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} error={errors.endTime} />
      <div className={`field${errors.reason ? " field--error" : ""}`}>
        <label htmlFor="unavailableReason">Reason</label>
        <select
          id="unavailableReason"
          name="unavailableReason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={errors.reason ? true : undefined}
          aria-describedby={errors.reason ? "unavailableReason-error" : undefined}
        >
          <option value="">Choose a reason</option>
          {SELECTABLE_UNAVAILABILITY_REASONS.map((r) => (
            <option key={r} value={r}>{UNAVAILABILITY_REASON_LABELS[r]}</option>
          ))}
        </select>
        {errors.reason && <p id="unavailableReason-error" className="field__error">{errors.reason}</p>}
      </div>
      <div className={`field${errors.notes ? " field--error" : ""}`}>
        <label htmlFor="unavailableNotes">Notes</label>
        <textarea
          id="unavailableNotes"
          name="unavailableNotes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-invalid={errors.notes ? true : undefined}
          aria-describedby={errors.notes ? "unavailableNotes-error" : undefined}
        />
        {errors.notes ? (
          <p id="unavailableNotes-error" className="field__error">{errors.notes}</p>
        ) : (
          <p className="field__hint">Required when the reason is Other.</p>
        )}
      </div>
      <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Mark unavailable"}</button>
    </form>
  );
}
