"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CHANGE_REQUEST_MESSAGES, parseEventChangeRequestInput, utcToSgt } from "@spm-t5/shared";
import { EventSection } from "@/components/event/EventSection";
import { InlineMessage } from "@/components/event/InlineMessage";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { Textarea } from "@/components/ui/textarea";
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
  const [endDate, setEndDate] = useState(end?.date ?? start?.date ?? "");
  const [startTime, setStartTime] = useState(start?.time ?? "");
  const [endTime, setEndTime] = useState(end?.time ?? "");
  const [venue, setVenue] = useState("");
  const [equipment, setEquipment] = useState(event.equipment_requirements_notes ?? "");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  const [saving, setSaving] = useState(false);

  // A single-day event moves its end date with its date; a multi-day event keeps the end date it has.
  function onDateChange(next: string) {
    if (endDate === date) setEndDate(next);
    setDate(next);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(undefined);

    const body = {
      expectedAttendance: attendance.trim() === "" && event.expected_attendance === null ? undefined : attendance,
      date: date || undefined,
      endDate: endDate || undefined,
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
    <EventSection id="change-request" title="Request a change">
      <p className="text-sm text-muted-foreground">
        The event keeps its current details until your request is approved.
      </p>

      {message && <InlineMessage kind={message.kind}>{message.text}</InlineMessage>}

      <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
        <div className="grid gap-5 sm:grid-cols-2">
          <InputField id="expectedAttendance" label="Expected attendance" type="text" inputMode="numeric"
            value={attendance} error={fieldErrors.expectedAttendance}
            onChange={(e) => setAttendance(e.target.value)} />
          <InputField id="date" label="Date" type="date" value={date} error={fieldErrors.date}
            onChange={(e) => onDateChange(e.target.value)} />
          <InputField id="startTime" label="Start time" type="time" value={startTime} error={fieldErrors.startTime}
            onChange={(e) => setStartTime(e.target.value)} />
          <InputField id="endDate" label="End date" type="date" value={endDate} error={fieldErrors.endDate}
            onChange={(e) => setEndDate(e.target.value)} />
          <InputField id="endTime" label="End time" type="time" value={endTime} error={fieldErrors.endTime}
            onChange={(e) => setEndTime(e.target.value)} />
        </div>
        <TextArea id="venueRequirements" label="Venue requirements" value={venue}
          error={fieldErrors.venueRequirements} onChange={setVenue} />
        <TextArea id="equipmentRequirements" label="Equipment requirements" value={equipment}
          error={fieldErrors.equipmentRequirements} onChange={setEquipment} />
        <TextArea id="reason" label="Reason for the change (optional)" value={reason}
          error={fieldErrors.reason} onChange={setReason} />

        <Button className="self-start" type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit change request"}</Button>
      </form>
    </EventSection>
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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      <Textarea id={id} rows={3} value={value} aria-invalid={error ? true : undefined}
        onChange={(e) => onChange(e.target.value)} />
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  );
}
