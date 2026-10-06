"use client";

import { useState, type FormEvent } from "react";
import { parseAvailabilityInput, utcToSgt } from "@spm-t5/shared";
import { Field } from "./Field";
import {
  checkEquipmentAvailability,
  unusableReason,
  type AvailabilityQuery,
  type AvailabilityResultView,
  type EquipmentOption,
} from "@/lib/equipmentAvailability";

interface Props {
  /** The catalogue, offered as name suggestions. */
  equipment: EquipmentOption[];
  /** Replaced by a pretend service in tests; defaults to asking equipment-service. */
  check?: typeof checkEquipmentAvailability;
}

// SCRUM-18: Technical Support Staff check whether enough units of a piece of equipment are free for a period.
// The input checks are the shared parseAvailabilityInput, so the prompts appear straight away and match
// equipment-service's word for word (AC4, AC6, AC7).
export function EquipmentAvailabilityForm({ equipment, check = checkEquipmentAvailability }: Props) {
  // Starts at 7:00 AM to 11:00 PM, so the time pickers open on whole hours; the date is left for the user to pick.
  const [query, setQuery] = useState<AvailabilityQuery>({
    equipmentName: "",
    quantity: "",
    date: "",
    startTime: "07:00",
    endTime: "23:00",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<AvailabilityResultView>();
  const [checking, setChecking] = useState(false);

  /** Keeps one box's value as the user types. */
  const set = (key: keyof AvailabilityQuery) => (e: { target: { value: string } }) =>
    setQuery((q) => ({ ...q, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setResult(undefined);

    // AC4, AC6, AC7: anything missing or wrong is shown straight away, without asking the service.
    const parsed = parseAvailabilityInput(query, new Date());
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});

    setChecking(true);
    const { ok, data } = await check(query);
    setChecking(false);
    if (ok) {
      setResult(data);
      return;
    }
    // AC5: an unknown name comes back from the service as a message for the name box.
    if (data.fieldErrors) setFieldErrors(data.fieldErrors);
    else setError(data.error ?? "We couldn't check availability. Please try again.");
  }

  const reason = result && unusableReason(result.operationalStatus);

  return (
    // Form on the left, the result on the right (stacked on narrow screens); see .equipment-check in globals.css.
    <div className="equipment-check">
      <form className="auth__form" onSubmit={onSubmit} noValidate>
        {error && (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        )}

        <Field id="equipmentName" label="Equipment name" list="equipment-names" autoComplete="off"
          value={query.equipmentName} onChange={set("equipmentName")} error={fieldErrors.equipmentName} />
        {/* 18-S11: the catalogue names, suggested as the user types */}
        <datalist id="equipment-names">
          {equipment.map((item) => (
            <option key={item.id} value={item.name} />
          ))}
        </datalist>

        <Field id="quantity" label="Quantity required" type="number" min={1} step={1} inputMode="numeric"
          value={query.quantity} onChange={set("quantity")} error={fieldErrors.quantity} />
        {/* data-empty lets the CSS hide the browser's "dd----yyyy" until a date is picked or the box is clicked */}
        {/* AC7: min greys out days before today (Singapore time) in the calendar, so a past date cannot be picked */}
        <Field id="date" label="Date" type="date" min={utcToSgt(new Date()).date} data-empty={query.date === "" ? "true" : undefined}
          value={query.date} onChange={set("date")} error={fieldErrors.date} />
        <Field id="startTime" label="Start time" type="time"
          value={query.startTime} onChange={set("startTime")} error={fieldErrors.startTime} />
        <Field id="endTime" label="End time" type="time"
          value={query.endTime} onChange={set("endTime")} error={fieldErrors.endTime} />

        <button className="btn" type="submit" disabled={checking}>
          {checking ? "Checking…" : "Check availability"}
        </button>
      </form>

      <div className="equipment-check__result">
        {result && (
          <section className={`alert ${result.sufficient ? "alert--ok" : "alert--error"}`} role="status">
            {/* AC2 / AC3 */}
            <h2>{result.sufficient ? "Available" : "Insufficient"}</h2>
            {/* AC1 */}
            <p>
              {result.equipmentName}: {result.availableQuantity} available, on {result.date}, {result.startTime} to{" "}
              {result.endTime}.
            </p>
            {/* AC3 */}
            {!result.sufficient && <p>Short by {result.shortfall}.</p>}
            {/* 18-S10 */}
            {reason && <p>{reason}</p>}
          </section>
        )}
      </div>
    </div>
  );
}
