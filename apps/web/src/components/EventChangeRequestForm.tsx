"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CHANGE_REQUEST_MESSAGES, parseEventChangeRequestInput, utcToSgt } from "@spm-t5/shared";
import { Field } from "./Field";
import { submitChangeRequest, type EventDetailView } from "@/lib/events";

// SCRUM-66/AC1, AC8: the organiser edits attendance, date, times and venue/equipment requirements, starting from
// the event's current details. Validation is the shared parseEventChangeRequestInput, so the form and
// event-service agree (AC4, AC5, AC9, AC10). The event itself is not changed (AC6).
export function EventChangeRequestForm({ event }: { event: EventDetailView }) {
  const router = useRouter();
  const start = event.preferred_start_datetime ? utcToSgt(new Date(event.preferred_start_datetime)) : undefined;
  const end = event.preferred_end_datetime ? utcToSgt(new Date(event.preferred_end_datetime)) : undefined;

  const [attendance, setAttendance] = useState(event.expected_attendance?.toString() ?? "");
  const [date, setDate] = useState(start?.date ?? "");
  const [startTime, setStartTime] = useState(start?.time ?? "");
  const [endTime, setEndTime] = useState(end?.time ?? "");
  const [venue, setVenue] = useState("");
  const [equipment, setEquipment] = useState(event.equipment_requirements_notes ?? "");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(undefined);

    // A multi-day event keeps its own end date; a single-day one moves its end with the date.
    const multiDay = start && end && start.date !== end.date;
    const body = {
      expectedAttendance: attendance.trim() === "" && event.expected_attendance === null ? undefined : attendance,
      date: date || undefined,
      endDate: multiDay ? end.date : date || undefined,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      venueRequirements: venue,
      equipmentRequirements: equipment,
      reason,
    };

    const parsed = parseEventChangeRequestInput(body, event, new Date());
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      if (parsed.noChanges) setMessage({ kind: "error", text: CHANGE_REQUEST_MESSAGES.NO_CHANGES });
      return;
    }
    setFieldErrors({});

    setSaving(true);
    const { ok, data } = await submitChangeRequest(event.id, body);
    if (ok) {
      setMessage({ kind: "ok", text: data.message ?? CHANGE_REQUEST_MESSAGES.SUBMITTED });
      setReason("");
      router.refresh(); // shows the new request in the list
    } else {
      if (data.fieldErrors) setFieldErrors(data.fieldErrors);
      setMessage({ kind: "error", text: data.error ?? "We couldn't submit the change request. Please try again." });
    }
    setSaving(false);
  }

  return (
    <section className="event" aria-labelledby="change-request">
      <h2 id="change-request">Request a change</h2>
      <p className="field__hint">
        The event keeps its current details until your request is approved.
      </p>

      {message && (
        <div className={`alert alert--${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </div>
      )}

      <form className="event__form" onSubmit={onSubmit} noValidate>
        <Field id="expectedAttendance" label="Expected attendance" type="text" inputMode="numeric"
          value={attendance} error={fieldErrors.expectedAttendance}
          onChange={(e) => setAttendance(e.target.value)} />
        <Field id="date" label="Date" type="date" value={date} error={fieldErrors.date}
          onChange={(e) => setDate(e.target.value)} />
        <Field id="startTime" label="Start time" type="time" value={startTime} error={fieldErrors.startTime}
          onChange={(e) => setStartTime(e.target.value)} />
        <Field id="endTime" label="End time" type="time" value={endTime} error={fieldErrors.endTime}
          onChange={(e) => setEndTime(e.target.value)} />
        <TextArea id="venueRequirements" label="Venue requirements" value={venue}
          error={fieldErrors.venueRequirements} onChange={setVenue} />
        <TextArea id="equipmentRequirements" label="Equipment requirements" value={equipment}
          error={fieldErrors.equipmentRequirements} onChange={setEquipment} />
        <TextArea id="reason" label="Reason for the change (optional)" value={reason}
          error={fieldErrors.reason} onChange={setReason} />

        <button className="btn" type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit change request"}</button>
      </form>
    </section>
  );
}

function TextArea({ id, label, value, error, onChange }: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className={`field${error ? " field--error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <textarea id={id} rows={3} value={value} aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)} />
      {error && <p className="field__error">{error}</p>}
    </div>
  );
}
