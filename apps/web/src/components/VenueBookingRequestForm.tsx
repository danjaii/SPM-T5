"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parseVenueBookingInput } from "@spm-t5/shared";
import { Field } from "./Field";
import { submitVenueBooking, type VenueBookingFormData, type VenueOption } from "@/lib/venueBookings";

// SCRUM-32/AC2: the coordinator picks a venue, date and time; the event's own details are shown read-only.
// Validation is the shared parseVenueBookingInput, so the form and venue-service agree (32-S5).
export function VenueBookingRequestForm({ form, venues }: { form: VenueBookingFormData; venues: VenueOption[] }) {
  const router = useRouter();
  const [venueId, setVenueId] = useState("");
  const [date, setDate] = useState(form.date ?? "");
  const [startTime, setStartTime] = useState(form.startTime ?? "");
  const [endTime, setEndTime] = useState(form.endTime ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);

    const input = { venueId, date, startTime, endTime };
    const parsed = parseVenueBookingInput(input, new Date());
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    const { ok, data } = await submitVenueBooking({ eventId: form.eventId, ...input });
    if (ok) {
      router.push(`/venue-bookings/${data.id}`);
      return;
    }
    if (data.fieldErrors) setFieldErrors(data.fieldErrors);
    setError(data.error ?? "We couldn't submit the request. Please try again.");
    setSaving(false);
  }

  return (
    <section className="event">
      <h1>Request a venue</h1>
      <p className="event__status">{form.eventName}</p>

      {error && <div className="alert alert--error" role="alert">{error}</div>}

      <form className="event__form" onSubmit={onSubmit} noValidate>
        <dl className="vb__facts">
          <dt>Expected attendance</dt>
          <dd>{form.expectedAttendance ?? "Not specified"}</dd>
          <dt>Venue requirements</dt>
          <dd>{form.venueRequirements || "None specified"}</dd>
          <dt>Accessibility needs</dt>
          <dd>{form.accessibilityNeeds || "None specified"}</dd>
        </dl>

        <div className={`field${fieldErrors.venueId ? " field--error" : ""}`}>
          <label htmlFor="venueId">Venue</label>
          <select id="venueId" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            <option value="">Choose a venue</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}{v.maxCapacity != null ? ` (capacity ${v.maxCapacity})` : ""}
              </option>
            ))}
          </select>
          {fieldErrors.venueId && <p className="field__error">{fieldErrors.venueId}</p>}
        </div>
        <Field id="date" label="Date" type="date" value={date} error={fieldErrors.date}
          onChange={(e) => setDate(e.target.value)} />
        <Field id="startTime" label="Start time" type="time" value={startTime} error={fieldErrors.startTime}
          onChange={(e) => setStartTime(e.target.value)} />
        <Field id="endTime" label="End time" type="time" value={endTime} error={fieldErrors.endTime}
          onChange={(e) => setEndTime(e.target.value)} />

        <button className="btn" type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit request"}</button>
      </form>
    </section>
  );
}
