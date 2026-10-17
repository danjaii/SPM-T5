"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { parseTechnicalAssignmentInput, TECHNICAL_ASSIGNMENT_NOTE_MAX, type TechnicalAssignmentBody } from "@spm-t5/shared";
import {
  assignTechnicalStaff,
  changeTechnicalAssignment,
  type EventTechnicalAssignmentsView,
  type TechnicalAssignmentView,
} from "@/lib/technicalAssignments";

type Values = Required<TechnicalAssignmentBody>;
type Key = keyof Values;

// SCRUM-20/AC1, AC2: the coordinator assigns a technician to one of the event's approved venue bookings, or changes an
// assignment's venue booking, times or note. Choosing a venue booking fills in its date and times, which can then be
// adjusted (for example to arrive early for setup). The shared rules check the form before it is sent (20-S12).
export function TechnicalAssignmentForm({
  eventId,
  data,
  assignment,
}: {
  eventId: string;
  data: EventTechnicalAssignmentsView;
  /** Given when changing; the technician then stays the same. */
  assignment?: TechnicalAssignmentView;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>({
    staffId: assignment?.staffId ?? "",
    venueBookingId: assignment?.venueBookingId ?? "",
    startDate: assignment?.startDate ?? "",
    startTime: assignment?.startTime ?? "",
    endDate: assignment?.endDate ?? "",
    endTime: assignment?.endTime ?? "",
    note: assignment?.note ?? "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const set = (key: Key) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  function chooseVenue(e: { target: { value: string } }) {
    const venue = data.venues.find((v) => v.id === e.target.value);
    setValues((v) =>
      venue
        ? { ...v, venueBookingId: venue.id, startDate: venue.date, startTime: venue.startTime, endDate: venue.date, endTime: venue.endTime }
        : { ...v, venueBookingId: e.target.value },
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const parsed = parseTechnicalAssignmentInput(values, { requireStaff: !assignment });
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});
    setSaving(true);
    const { ok, data: reply } = assignment
      ? await changeTechnicalAssignment(assignment.id, { ...values, staffId: undefined })
      : await assignTechnicalStaff(eventId, values);
    setSaving(false);
    if (ok) {
      router.push(`/events/${eventId}`);
      return;
    }
    if (reply.fieldErrors) setFieldErrors(reply.fieldErrors);
    setError(reply.error ?? "We couldn't save the assignment. Please try again.");
  }

  function field(key: Key, label: string, input: ReactNode) {
    return (
      <div className={`field${fieldErrors[key] ? " field--error" : ""}`}>
        <label htmlFor={key}>{label}</label>
        {input}
        {fieldErrors[key] && (
          <p id={`${key}-error`} className="field__error">
            {fieldErrors[key]}
          </p>
        )}
      </div>
    );
  }
  const described = (key: Key) => (fieldErrors[key] ? `${key}-error` : undefined);
  const typed = (key: Key, label: string, type: string) =>
    field(key, label, <input id={key} type={type} value={values[key]} aria-describedby={described(key)} onChange={set(key)} />);

  return (
    <section className="event">
      <h1>{assignment ? "Change on-site assignment" : "Assign technical support staff"}</h1>
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}
      <form className="event__form" onSubmit={onSubmit} noValidate>
        {assignment ? (
          <p className="event__status">
            Technician: <strong>{assignment.staffName ?? "Unknown"}</strong>
          </p>
        ) : (
          field(
            "staffId",
            "Technical support staff",
            <select id="staffId" value={values.staffId} aria-describedby={described("staffId")} onChange={set("staffId")}>
              <option value="">Choose a technician</option>
              {data.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>,
          )
        )}
        {field(
          "venueBookingId",
          "Venue booking",
          <select id="venueBookingId" value={values.venueBookingId} aria-describedby={described("venueBookingId")} onChange={chooseVenue}>
            <option value="">Choose a venue booking</option>
            {data.venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.venueName}, {v.date} {v.startTime}–{v.endTime}
              </option>
            ))}
          </select>,
        )}
        {typed("startDate", "Start date", "date")}
        {typed("startTime", "Start time", "time")}
        {typed("endDate", "End date", "date")}
        {typed("endTime", "End time", "time")}
        {field(
          "note",
          "Note (optional)",
          <textarea id="note" rows={2} value={values.note} maxLength={TECHNICAL_ASSIGNMENT_NOTE_MAX} onChange={set("note")} />,
        )}
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Saving…" : assignment ? "Save changes" : "Assign"}
        </button>
      </form>
    </section>
  );
}
