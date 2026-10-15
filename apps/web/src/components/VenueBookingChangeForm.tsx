"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parseVenueBookingInput, VENUE_REQUIREMENTS_MAX_LENGTH } from "@spm-t5/shared";
import { Field } from "./Field";
import type { EquipmentRequestView } from "@/lib/equipmentRequests";
import { changeVenueBooking, type VenueBookingChangeBody, type VenueBookingDetailView } from "@/lib/venueBookings";

// SCRUM-102/AC1: change one venue booking's date, times, expected attendance or requirements. Its venue is shown but cannot
// change (a different venue is another venue booking). It goes back to venue staff for approval. Validation is the shared
// parseVenueBookingInput, as on the request form. AC8: the equipment requested for it moves with a new date or time and goes
// back to Technical Support Staff, said as a statement.
export function VenueBookingChangeForm({ booking, equipment }: { booking: VenueBookingDetailView; equipment: EquipmentRequestView[] }) {
  const router = useRouter();
  const [date, setDate] = useState(booking.date);
  const [startTime, setStartTime] = useState(booking.startTime);
  const [endTime, setEndTime] = useState(booking.endTime);
  const [attendance, setAttendance] = useState(booking.expectedAttendance === null ? "" : String(booking.expectedAttendance));
  const [requirements, setRequirements] = useState(booking.venueRequirements ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const parsed = parseVenueBookingInput(
      {
        venueId: booking.venueId,
        date,
        startTime,
        endTime,
        expectedAttendance: attendance.trim() === "" ? undefined : Number(attendance),
        venueRequirements: requirements,
      },
      new Date(),
    );
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});

    const body: VenueBookingChangeBody = { date, startTime, endTime };
    if (parsed.data.expectedAttendance !== undefined) body.expectedAttendance = parsed.data.expectedAttendance;
    if (parsed.data.venueRequirements !== undefined) body.venueRequirements = parsed.data.venueRequirements;

    setSaving(true);
    const { ok, data } = await changeVenueBooking(booking.id, body);
    if (ok) {
      router.push(`/events/${booking.eventId}`);
      return;
    }
    if (data.fieldErrors) setFieldErrors(data.fieldErrors);
    setError(data.error ?? "We couldn't save the change. Please try again.");
    setSaving(false);
  }

  return (
    <section className="event">
      <h1>Change venue booking</h1>
      <p className="event__status">{booking.eventName}</p>

      {error && <div className="alert alert--error" role="alert">{error}</div>}

      <form className="event__form" onSubmit={onSubmit} noValidate>
        <dl className="vb__facts">
          <dt>Venue</dt>
          <dd>{booking.venueName}</dd>
        </dl>
        <p className="field__hint">The changed venue booking goes back to venue staff for approval.</p>

        {equipment.length > 0 && (
          <div className="alert alert--info" role="note">
            <p>A new date or time moves this equipment with it and sends it back to Technical Support Staff for review:</p>
            <ul className="vb__list">
              {equipment.map((r) => (
                <li key={r.id}>
                  {r.quantity} × {r.equipment} ({r.statusLabel})
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field id="date" label="Date" type="date" value={date} error={fieldErrors.date} onChange={(e) => setDate(e.target.value)} />
        <Field id="startTime" label="Start time" type="time" value={startTime} error={fieldErrors.startTime}
          onChange={(e) => setStartTime(e.target.value)} />
        <Field id="endTime" label="End time" type="time" value={endTime} error={fieldErrors.endTime}
          onChange={(e) => setEndTime(e.target.value)} />
        <Field id="expectedAttendance" label="Expected attendance for this venue" type="number" min={1} step={1}
          value={attendance} error={fieldErrors.expectedAttendance} onChange={(e) => setAttendance(e.target.value)} />
        <Field id="venueRequirements" label="Venue requirements for this venue" maxLength={VENUE_REQUIREMENTS_MAX_LENGTH}
          value={requirements} error={fieldErrors.venueRequirements} onChange={(e) => setRequirements(e.target.value)} />

        <button className="btn" type="submit" disabled={saving}>{saving ? "Saving…" : "Save change"}</button>
      </form>
    </section>
  );
}
