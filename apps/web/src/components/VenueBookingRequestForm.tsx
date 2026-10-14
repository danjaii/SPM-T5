"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { exceedsCapacity, parseVenueBookingInput, VENUE_REQUIREMENTS_MAX_LENGTH } from "@spm-t5/shared";
import { Field } from "./Field";
import { SuitabilityCheck } from "./SuitabilityCheck";
import {
  submitVenueBooking,
  type VenueBookingFormData,
  type VenueBookingInputBody,
  type VenueOption,
} from "@/lib/venueBookings";

type Slot = Omit<VenueBookingInputBody, "eventId">;

interface Props {
  form: VenueBookingFormData;
  venues: VenueOption[];
  /** SCRUM-60: start from the rejected request's slot and submit as an amendment instead. */
  initial?: Partial<Slot>;
  heading?: string;
  submitLabel?: string;
  submit?: (input: Slot) => ReturnType<typeof submitVenueBooking>;
}

// SCRUM-32/AC2: the coordinator picks a venue, date and time; the event's own details are shown read-only.
// Validation is the shared parseVenueBookingInput, so the form and venue-service agree (32-S5).
// SCRUM-98/AC2: this venue booking can have its own expected attendance and venue requirements (blank means the event's),
// and the form warns, without blocking, when the chosen venue holds fewer people than expected (98-S10).
export function VenueBookingRequestForm({ form, venues, initial, heading, submitLabel, submit }: Props) {
  const router = useRouter();
  const [venueId, setVenueId] = useState(initial?.venueId ?? "");
  const [date, setDate] = useState(initial?.date ?? form.date ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? form.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? form.endTime ?? "");
  const [ownAttendance, setOwnAttendance] = useState("");
  const [ownRequirements, setOwnRequirements] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);

    const parsed = parseVenueBookingInput(
      {
        venueId, date, startTime, endTime,
        // blank means "use the event's", so it is left out (98-S7)
        expectedAttendance: ownAttendance.trim() === "" ? undefined : Number(ownAttendance),
        venueRequirements: ownRequirements,
      },
      new Date(),
    );
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});

    const input: Slot = { venueId, date, startTime, endTime };
    if (parsed.data.expectedAttendance !== undefined) input.expectedAttendance = parsed.data.expectedAttendance;
    if (parsed.data.venueRequirements !== undefined) input.venueRequirements = parsed.data.venueRequirements;

    setSaving(true);
    const { ok, data } = await (submit ?? ((slot) => submitVenueBooking({ eventId: form.eventId, ...slot })))(input);
    if (ok) {
      router.push(`/venue-bookings/${data.id}`);
      return;
    }
    if (data.fieldErrors) setFieldErrors(data.fieldErrors);
    setError(data.error ?? "We couldn't submit the request. Please try again.");
    setSaving(false);
  }

  // 98-S10: the venue booking's own attendance if a valid one is typed, the event's if not
  const typed = Number(ownAttendance);
  const attendance = ownAttendance.trim() !== "" && Number.isInteger(typed) && typed >= 1 ? typed : form.expectedAttendance;
  const chosen = venues.find((v) => v.id === venueId);
  const tooSmall = chosen && exceedsCapacity(attendance, chosen.max_capacity) ? chosen : undefined;

  return (
    <section className="event">
      <h1>{heading ?? "Request a venue"}</h1>
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
                {v.name}{v.max_capacity != null ? ` (capacity ${v.max_capacity})` : ""}
              </option>
            ))}
          </select>
          {fieldErrors.venueId && <p className="field__error">{fieldErrors.venueId}</p>}
        </div>
        {tooSmall && (
          <p className="alert alert--warning" role="status">
            {`${tooSmall.name} holds ${tooSmall.max_capacity} people, but ${attendance} are expected. You can still submit: venue staff will see this when they decide.`}
          </p>
        )}
        <Field id="date" label="Date" type="date" value={date} error={fieldErrors.date}
          onChange={(e) => setDate(e.target.value)} />
        <Field id="startTime" label="Start time" type="time" value={startTime} error={fieldErrors.startTime}
          onChange={(e) => setStartTime(e.target.value)} />
        <Field id="endTime" label="End time" type="time" value={endTime} error={fieldErrors.endTime}
          onChange={(e) => setEndTime(e.target.value)} />
        <Field id="expectedAttendance" label="Expected attendance for this venue" type="number" min={1} step={1}
          value={ownAttendance} error={fieldErrors.expectedAttendance}
          hint={`Leave blank to use the event's: ${form.expectedAttendance ?? "not specified"}`}
          onChange={(e) => setOwnAttendance(e.target.value)} />
        <Field id="venueRequirements" label="Venue requirements for this venue" maxLength={VENUE_REQUIREMENTS_MAX_LENGTH}
          value={ownRequirements} error={fieldErrors.venueRequirements}
          hint={`Leave blank to use the event's: ${form.venueRequirements || "none specified"}`}
          onChange={(e) => setOwnRequirements(e.target.value)} />

        {/* SCRUM-109: information before requesting; it does not stop the request. */}
        <SuitabilityCheck eventId={form.eventId} venueId={venueId} date={date} startTime={startTime} endTime={endTime} />

        <button className="btn" type="submit" disabled={saving}>{saving ? "Submitting…" : (submitLabel ?? "Submit request")}</button>
      </form>
    </section>
  );
}
