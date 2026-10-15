"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  EVENT_NAME_MAX_LENGTH,
  EVENT_TEXT_MAX_LENGTH,
  eventDetailsFromFormValues,
  parseEventDetailsInput,
  type EventDetailsFormValues,
} from "@spm-t5/shared";
import { saveEventDetails, type EventEditForm } from "@/lib/events";

type Key = keyof EventDetailsFormValues;

/** The marker on an important field (AC2): it may affect venue or equipment arrangements. */
const IMPORTANT_NOTE = "Important: may affect venue or equipment arrangements";

// SCRUM-111: the assigned coordinator edits an event's planning information. Ordinary and important fields are shown in two
// groups, and each important field is marked (AC2). The shared rules check the form before it is sent (AC3), and saving
// goes back to the event page, which says it was saved (AC5).
export function EventDetailsForm({ eventId, form }: { eventId: string; form: EventEditForm }) {
  const router = useRouter();
  const [values, setValues] = useState<EventDetailsFormValues>(form.values);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const set = (key: Key) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const important = (key: Key) => form.importantFields.includes(key);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    // the same rules as event-service, against the details the form started from
    const parsed = parseEventDetailsInput(values, eventDetailsFromFormValues(form.values), new Date());
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      if (parsed.noChanges) setError("Nothing was changed.");
      return;
    }
    setFieldErrors({});
    setSaving(true);
    const { ok, data } = await saveEventDetails(eventId, values);
    if (ok) {
      router.push(`/events/${eventId}?saved=1`);
      return;
    }
    if (data.fieldErrors) setFieldErrors(data.fieldErrors);
    setError(data.error ?? "We couldn't save the event details. Please try again.");
    setSaving(false);
  }

  /** One labelled box; an important one says so under its label. */
  function field(key: Key, label: string, input: ReactNode) {
    const errorText = fieldErrors[key];
    return (
      <div className={`field${errorText ? " field--error" : ""}`}>
        <label htmlFor={key}>{label}</label>
        {important(key) && (
          <p id={`${key}-important`} className="field__hint field__hint--important">
            {IMPORTANT_NOTE}
          </p>
        )}
        {input}
        {errorText && (
          <p id={`${key}-error`} className="field__error">
            {errorText}
          </p>
        )}
      </div>
    );
  }

  const described = (key: Key) =>
    [important(key) ? `${key}-important` : null, fieldErrors[key] ? `${key}-error` : null].filter(Boolean).join(" ") || undefined;
  const text = (key: Key, label: string, max = EVENT_TEXT_MAX_LENGTH) =>
    field(key, label, <input id={key} value={String(values[key])} maxLength={max} aria-describedby={described(key)} onChange={set(key)} />);
  const area = (key: Key, label: string) =>
    field(key, label, <textarea id={key} rows={3} value={String(values[key])} maxLength={EVENT_TEXT_MAX_LENGTH} aria-describedby={described(key)} onChange={set(key)} />);
  const typed = (key: Key, label: string, type: string) =>
    field(key, label, <input id={key} type={type} value={String(values[key])} aria-describedby={described(key)} onChange={set(key)} />);
  const choice = (key: Key, label: string, options: { id: string; name: string }[]) =>
    field(
      key,
      label,
      <select id={key} value={String(values[key])} aria-describedby={described(key)} onChange={set(key)}>
        <option value="">None</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>,
    );

  return (
    <section className="event">
      <h1>Edit event details</h1>
      <p className="event__status">{form.values.name}</p>
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}

      <form className="event__form" onSubmit={onSubmit} noValidate>
        <fieldset>
          <legend>Event details</legend>
          {text("name", "Event name", EVENT_NAME_MAX_LENGTH)}
          {area("description", "Description")}
          {area("purpose", "Purpose")}
          {choice("categoryId", "Category", form.categories)}
        </fieldset>

        <fieldset>
          <legend>Important details</legend>
          <p className="field__hint">Changing these may affect the event&apos;s venue bookings and equipment requests.</p>
          {typed("date", "Date", "date")}
          {typed("startTime", "Start time", "time")}
          {typed("endDate", "End date", "date")}
          {typed("endTime", "End time", "time")}
          {typed("expectedAttendance", "Expected attendance", "number")}
          {choice("roomLayoutId", "Room layout", form.roomLayouts)}
          {area("accessibilityRequirements", "Accessibility needs")}
          {area("venueRequirements", "Venue requirements")}
          {area("equipmentRequirements", "Equipment requirements")}
        </fieldset>

        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </form>
    </section>
  );
}
