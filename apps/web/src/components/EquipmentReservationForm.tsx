"use client";

import { useState, type FormEvent } from "react";
import { periodFormatErrors, periodMissing, periodTimingError, quantityError } from "@spm-t5/shared";
import { Field } from "./Field";
import type { ApiResult } from "@/lib/api";
import { unusableReason } from "@/lib/equipmentAvailability";
import type {
  EquipmentCardView,
  ReservableEventView,
  ReservationConfirmationView,
  ReservationRequest,
} from "@/lib/equipmentReservation";
import { reserveEquipment } from "@/lib/equipmentReservation";

interface Props {
  /** Approved events that have not started yet. */
  events: ReservableEventView[];
  /** The catalogue, shown as cards. */
  equipment: EquipmentCardView[];
  /** Replaced by a pretend service in tests; defaults to asking equipment-service. */
  reserve?: (reservation: ReservationRequest) => Promise<ApiResult<ReservationConfirmationView>>;
}

// SCRUM-19: Technical Support Staff reserve equipment for an event. Built up one test at a time.
export function EquipmentReservationForm({ events, equipment, reserve = reserveEquipment }: Props) {
  const [eventId, setEventId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [confirmation, setConfirmation] = useState<ReservationConfirmationView>();
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /** AC6: the cards whose name contains what was typed in the search box, ignoring capital letters. */
  const shownEquipment = equipment.filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()));

  /** AC8: choosing an event fills in its date and times; the boxes stay editable for a shorter period. */
  function chooseEvent(id: string) {
    setEventId(id);
    const chosen = events.find((event) => event.id === id);
    if (!chosen) return;
    setDate(chosen.date);
    setStartTime(chosen.startTime);
    setEndTime(chosen.endTime);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setConfirmation(undefined);
    setError(undefined);
    const period = { date: date.trim(), startTime: startTime.trim(), endTime: endTime.trim() };

    // The same three stages as equipment-service, so the user sees the same messages: missing, then format, then timing.
    // Stage 1, missing. 19-S9: no event. AC6: no equipment. AC7: no quantity. AC8: no date or time.
    const missing: Record<string, string> = { ...periodMissing(period) };
    if (eventId === "") missing.eventId = "Please select the event.";
    if (selectedEquipmentId === "") missing.equipmentId = "Please select the equipment.";
    if (quantity.trim() === "") missing.quantity = quantityError(quantity)!;
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      return;
    }

    // Stage 2, format: a quantity that is not a whole number of at least 1, or a date or time in the wrong shape.
    const invalid: Record<string, string> = { ...periodFormatErrors(period) };
    const quantityProblem = quantityError(quantity);
    if (quantityProblem) invalid.quantity = quantityProblem;
    if (Object.keys(invalid).length > 0) {
      setFieldErrors(invalid);
      return;
    }

    // Stage 3, timing: the end must be after the start, and the start must not be in the past.
    const timing = periodTimingError(period, new Date());
    if (!timing.ok) {
      setFieldErrors(timing.fieldErrors);
      return;
    }
    setFieldErrors({});

    // AC1: everything is fine, so ask equipment-service to reserve it (it checks again).
    const { ok, data } = await reserve({ eventId, equipmentId: selectedEquipmentId, quantity, date, startTime, endTime });
    // AC2 + AC3: show what was reserved and how many are still free.
    if (ok) setConfirmation(data);
    // AC4: refused (for example not enough is free): tell the user the service's reason. Nothing is confirmed (AC5).
    else setError(data.error);
  }

  return (
    <form className="reserve-form" onSubmit={onSubmit} noValidate>
      {error && (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      )}
      {confirmation && (
        <section className="alert alert--ok" role="status">
          {/* AC2 */}
          <h2>Reserved</h2>
          <p>
            {confirmation.equipmentName}: {confirmation.quantity} reserved, on {confirmation.date},{" "}
            {confirmation.startTime} to {confirmation.endTime}.
          </p>
          {/* AC3 */}
          <p>{confirmation.availableAfter} still available for that period.</p>
        </section>
      )}
      {/* The fields sit on the left and the equipment to choose from on the right (see .reserve-form in globals.css) */}
      <div className="reserve-form__grid">
      <div className={`field${fieldErrors.eventId ? " field--error" : ""}`}>
        <label htmlFor="eventId">Event</label>
        <select id="eventId" name="eventId" value={eventId} onChange={(e) => chooseEvent(e.target.value)}>
          <option value="">Select an event</option>
          {events.map((event) => (
            <option key={event.id} value={event.id}>
              {event.name}
            </option>
          ))}
        </select>
        {fieldErrors.eventId && <p className="field__error">{fieldErrors.eventId}</p>}
      </div>
      <div className="equipment-picker">
      <Field id="equipmentSearch" label="Search equipment" type="search" autoComplete="off"
        value={search} onChange={(e) => setSearch(e.target.value)} />
      {/* AC6: one card per catalogue item, to choose from */}
      <p className="equipment-picker__label" id="equipmentLabel">Select equipment</p>
      <div className="equipment-picker__list" role="group" aria-labelledby="equipmentLabel">
        {shownEquipment.map((item) => (
          <button key={item.id} className="equipment-card" type="button" disabled={unusableReason(item.operationalStatus) !== null} aria-pressed={selectedEquipmentId === item.id}
            onClick={() => setSelectedEquipmentId(selectedEquipmentId === item.id ? "" : item.id)}>
            {item.name}
          </button>
        ))}
      </div>
      {fieldErrors.equipmentId && <p className="field__error" role="alert">{fieldErrors.equipmentId}</p>}
      </div>
      <Field id="quantity" label="Quantity required" type="number" min={1} step={1} inputMode="numeric"
        value={quantity} onChange={(e) => setQuantity(e.target.value)} error={fieldErrors.quantity} />
      {/* data-empty lets the CSS hide the browser's "dd-mm-yyyy" and "--:--" hints while a box is empty */}
      <Field id="date" label="Date" type="date" data-empty={date === "" ? "true" : undefined} value={date} onChange={(e) => setDate(e.target.value)} error={fieldErrors.date} />
      <Field id="startTime" label="Start time" type="time" data-empty={startTime === "" ? "true" : undefined} value={startTime}
        onChange={(e) => setStartTime(e.target.value)} error={fieldErrors.startTime} />
      <Field id="endTime" label="End time" type="time" data-empty={endTime === "" ? "true" : undefined} value={endTime}
        onChange={(e) => setEndTime(e.target.value)} error={fieldErrors.endTime} />
      <button className="btn" type="submit">
        Reserve equipment
      </button>
      </div>
    </form>
  );
}
