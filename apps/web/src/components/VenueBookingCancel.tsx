"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseCancellationInput, REJECTION_REASON_MAX_LENGTH } from "@spm-t5/shared";
import type { EquipmentRequestView } from "@/lib/equipmentRequests";
import { cancelVenueBooking, type EventVenueBookingItem } from "@/lib/venueBookings";
import { Button } from "@/components/ui/button";

// SCRUM-102/AC2, AC4: cancel one venue booking of the event, after a confirmation that asks for a reason; going back sends
// nothing. AC7: the confirmation lists the equipment requested for this venue booking, which is released with it. There is
// no choice about that, so it is said as a statement and the button says what will happen.
export function VenueBookingCancel({ booking, equipment }: { booking: EventVenueBookingItem; equipment: EquipmentRequestView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  function goBack() {
    setOpen(false);
    setReason("");
    setReasonError(undefined);
    setError(undefined);
  }

  async function confirm() {
    const parsed = parseCancellationInput({ reason });
    if (!parsed.ok) {
      setReasonError(parsed.fieldErrors.reason);
      return;
    }
    setReasonError(undefined);
    setError(undefined);
    setBusy(true);
    const { ok, data } = await cancelVenueBooking(booking.id, parsed.data.reason);
    setBusy(false);
    if (ok) {
      setOpen(false);
      router.refresh();
      return;
    }
    setError(data.fieldErrors?.reason ?? data.error ?? "We couldn't cancel the venue booking. Please try again.");
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" type="button" onClick={() => setOpen(true)} aria-label={`Cancel the ${booking.venueName} venue booking`}>
        Cancel
      </Button>
    );
  }

  const fieldId = `cancel-reason-${booking.id}`;
  return (
    <div className="vb__confirm" role="alertdialog" aria-label="Cancel venue booking">
      <p>
        <strong>Cancel venue booking:</strong> {booking.venueName}, {booking.date}, {booking.startTime}–{booking.endTime}
      </p>
      {equipment.length > 0 && (
        <>
          <p>This also releases the equipment requested for it:</p>
          <ul className="vb__list">
            {equipment.map((r) => (
              <li key={r.id}>
                {r.quantity} × {r.equipment} ({r.statusLabel})
              </li>
            ))}
          </ul>
        </>
      )}
      {error && <div className="alert alert--error" role="alert">{error}</div>}
      <div className={`field${reasonError ? " field--error" : ""}`}>
        <label htmlFor={fieldId}>Reason for cancelling</label>
        <textarea
          id={fieldId}
          rows={3}
          value={reason}
          maxLength={REJECTION_REASON_MAX_LENGTH + 50}
          aria-invalid={reasonError ? true : undefined}
          onChange={(e) => setReason(e.target.value)}
        />
        {reasonError && <p className="field__error" role="alert">{reasonError}</p>}
      </div>
      <p>
        <Button variant="destructive" size="sm" type="button" disabled={busy} onClick={confirm}>
          {busy ? "Cancelling…" : equipment.length > 0 ? "Cancel venue booking and release equipment" : "Cancel venue booking"}
        </Button>{" "}
        <Button variant="outline" size="sm" type="button" disabled={busy} onClick={goBack}>
          Go back
        </Button>
      </p>
    </div>
  );
}
