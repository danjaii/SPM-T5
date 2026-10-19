"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parseEquipmentRequestInput } from "@spm-t5/shared";
import { Field } from "./Field";
import {
  submitEquipmentRequest,
  updateEquipmentRequest,
  type EquipmentRequestEditFormData,
  type EquipmentRequestFormData,
} from "@/lib/equipmentRequests";

// SCRUM-86/AC1: the assigned coordinator picks an item (listed under its type), a quantity and one of the event's
// approved venues, with optional technical notes. AC4, AC5: validation is the shared parseEquipmentRequestInput, so the
// form and equipment-service agree; invalid fields are highlighted and everything typed is kept.
// SCRUM-88/AC1: given an `existing` request, the same form changes it, starting on its current details. AC2: saving
// sends it back to Technical Support Staff, which the form says first. AC3: a refused change keeps what was typed,
// and the old details stay saved.
export function EquipmentRequestForm({
  form,
  existing,
}: {
  form: EquipmentRequestFormData;
  existing?: EquipmentRequestEditFormData["request"];
}) {
  const router = useRouter();
  // An item or venue no longer offered (retired, or no longer approved) starts unchosen, so the coordinator picks again.
  const offered = <T extends { id: string }>(list: T[], id: string | null | undefined) =>
    id && list.some((o) => o.id === id) ? id : "";
  const [equipmentId, setEquipmentId] = useState(offered(form.equipment, existing?.equipmentId));
  const [quantity, setQuantity] = useState(existing ? String(existing.quantity) : "");
  // With one approved venue there is nothing to choose, so it is picked already.
  const [venueBookingId, setVenueBookingId] = useState(
    existing ? offered(form.venues, existing.venueBookingId) : form.venues.length === 1 ? form.venues[0].id : "",
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);

    const input = { equipmentId, quantity, venueBookingId, notes };
    const parsed = parseEquipmentRequestInput(input);
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    const { ok, data } = existing
      ? await updateEquipmentRequest(form.event.id, existing.id, input)
      : await submitEquipmentRequest(form.event.id, input);
    if (ok) {
      // AC2: back to the event, where the new (or changed) request is listed as Submitted.
      router.push(`/events/${form.event.id}`);
      router.refresh();
      return;
    }
    if (data.fieldErrors) setFieldErrors(data.fieldErrors);
    setError(data.error ?? (existing ? "We couldn't save your changes. Please try again." : "We couldn't submit the request. Please try again."));
    setSaving(false);
  }

  return (
    <section className="event">
      <h1>{existing ? "Change equipment request" : "Request equipment"}</h1>
      <p className="event__status">{form.event.name}</p>

      {error && <div className="alert alert--error" role="alert">{error}</div>}
      {existing && existing.status !== "SUBMITTED" && (
        <p className="alert alert--info" role="status">
          This request is {existing.statusLabel}. Saving a change sends it back to Technical Support Staff as Submitted,
          marked Updated, so they can review it again.
        </p>
      )}
      {form.venues.length === 0 && (
        <p className="alert alert--info" role="status">
          This event has no approved venue booking yet. Equipment is requested for a booked venue, so request a venue
          first.
        </p>
      )}

      <form className="event__form" onSubmit={onSubmit} noValidate>
        <div className={`field${fieldErrors.equipmentId ? " field--error" : ""}`}>
          <label htmlFor="equipmentId">Equipment</label>
          <select
            id="equipmentId"
            value={equipmentId}
            aria-invalid={fieldErrors.equipmentId ? true : undefined}
            aria-describedby={fieldErrors.equipmentId ? "equipmentId-error" : undefined}
            onChange={(e) => setEquipmentId(e.target.value)}
          >
            <option value="">Choose the equipment</option>
            {form.equipment.map((item) => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </select>
          {fieldErrors.equipmentId && <p id="equipmentId-error" className="field__error">{fieldErrors.equipmentId}</p>}
        </div>

        {/* Text, not type="number": the browser would quietly drop "abc" or "1.5", and AC5 asks to say why it's wrong */}
        <Field id="quantity" label="Quantity" inputMode="numeric" value={quantity} error={fieldErrors.quantity}
          onChange={(e) => setQuantity(e.target.value)} />

        <div className={`field${fieldErrors.venueBookingId ? " field--error" : ""}`}>
          <label htmlFor="venueBookingId">Venue</label>
          <select
            id="venueBookingId"
            value={venueBookingId}
            aria-invalid={fieldErrors.venueBookingId ? true : undefined}
            aria-describedby={fieldErrors.venueBookingId ? "venueBookingId-error" : undefined}
            onChange={(e) => setVenueBookingId(e.target.value)}
          >
            <option value="">Choose the venue</option>
            {form.venues.map((v) => (
              <option key={v.id} value={v.id}>{v.venueName} ({v.date}, {v.startTime}–{v.endTime})</option>
            ))}
          </select>
          {fieldErrors.venueBookingId && <p id="venueBookingId-error" className="field__error">{fieldErrors.venueBookingId}</p>}
        </div>

        <div className="field">
          <label htmlFor="notes">Technical notes (optional)</label>
          <textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <button className="btn" type="submit" disabled={saving}>
          {existing ? (saving ? "Saving…" : "Save changes") : saving ? "Submitting…" : "Submit request"}
        </button>
      </form>
    </section>
  );
}
