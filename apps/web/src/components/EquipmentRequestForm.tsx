"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parseEquipmentRequestInput } from "@spm-t5/shared";
import { Field } from "./Field";
import { submitEquipmentRequest, type EquipmentRequestFormData } from "@/lib/equipmentRequests";

// SCRUM-86/AC1: the assigned coordinator picks an item (listed under its type), a quantity and one of the event's
// approved venues, with optional technical notes. AC4, AC5: validation is the shared parseEquipmentRequestInput, so the
// form and equipment-service agree; invalid fields are highlighted and everything typed is kept.
export function EquipmentRequestForm({ form }: { form: EquipmentRequestFormData }) {
  const router = useRouter();
  const [equipmentId, setEquipmentId] = useState("");
  const [quantity, setQuantity] = useState("");
  // With one approved venue there is nothing to choose, so it is picked already.
  const [venueBookingId, setVenueBookingId] = useState(form.venues.length === 1 ? form.venues[0].id : "");
  const [notes, setNotes] = useState("");
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
    const { ok, data } = await submitEquipmentRequest(form.event.id, input);
    if (ok) {
      // AC2: back to the event, where the new request is listed as Submitted.
      router.push(`/events/${form.event.id}`);
      router.refresh();
      return;
    }
    if (data.fieldErrors) setFieldErrors(data.fieldErrors);
    setError(data.error ?? "We couldn't submit the request. Please try again.");
    setSaving(false);
  }

  return (
    <section className="event">
      <h1>Request equipment</h1>
      <p className="event__status">{form.event.name}</p>

      {error && <div className="alert alert--error" role="alert">{error}</div>}
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

        <button className="btn" type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit request"}</button>
      </form>
    </section>
  );
}
