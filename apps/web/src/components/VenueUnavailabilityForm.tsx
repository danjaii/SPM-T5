"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  bookingsFlaggedMessage,
  formatShortSgt,
  parseUnavailabilityInput,
  SELECTABLE_UNAVAILABILITY_REASONS,
  UNAVAILABILITY_REASON_LABELS,
} from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { Textarea } from "@/components/ui/textarea";
import { postVenueUnavailability } from "@/lib/venueUnavailability";

type Errors = Partial<Record<"startDate" | "startTime" | "endDate" | "endTime" | "reason" | "notes", string>>;

const LABEL = "text-sm font-semibold text-foreground";
const ERROR = "text-sm font-medium text-destructive";
// The reason list is a native select so a screen reader and the keyboard get it for free; it is styled like the Input.
const SELECT =
  "h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive";

// SCRUM-105: Venue Staff mark a venue unavailable for a period with a reason. Shown only to them (the server says so with
// can_mark_unavailable, and checks again, and so does the database). It validates with the same parser as venue-service, so a
// missing reason (105-S2) or an end that is not after the start (105-S3) never leaves the browser and nothing is saved.
// SCRUM-129/AC2: opened from the venue's Mark unavailable button; a save is confirmed in the form and with a toast.
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
      // SCRUM-106: "3 bookings affected; their coordinators have been notified." or "No existing bookings are affected."
      const flagged = bookingsFlaggedMessage(data.affectedBookings ?? 0);
      setSaved(`Marked unavailable from ${formatShortSgt(parsed.data.start)} to ${formatShortSgt(parsed.data.end)}. ${flagged}`);
      toast.success("Venue marked unavailable");
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
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-label="Mark this venue unavailable">
      {failure && <AuthAlert tone="error">{failure}</AuthAlert>}
      {saved && <AuthAlert tone="ok">{saved}</AuthAlert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <InputField id="unavailableStartDate" label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} error={errors.startDate} />
        <InputField id="unavailableStartTime" label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} error={errors.startTime} />
        <InputField id="unavailableEndDate" label="End date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} error={errors.endDate} />
        <InputField id="unavailableEndTime" label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} error={errors.endTime} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="unavailableReason" className={LABEL}>Reason</label>
        <select
          id="unavailableReason"
          name="unavailableReason"
          className={SELECT}
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
        {errors.reason && <p id="unavailableReason-error" className={ERROR}>{errors.reason}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="unavailableNotes" className={LABEL}>Notes</label>
        <Textarea
          id="unavailableNotes"
          name="unavailableNotes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-invalid={errors.notes ? true : undefined}
          aria-describedby="unavailableNotes-message"
        />
        {errors.notes ? (
          <p id="unavailableNotes-message" className={ERROR}>{errors.notes}</p>
        ) : (
          <p id="unavailableNotes-message" className="text-sm text-muted-foreground">Required when the reason is Other.</p>
        )}
      </div>
      <Button type="submit" disabled={busy} className="self-start">{busy ? "Saving…" : "Save unavailable period"}</Button>
    </form>
  );
}
