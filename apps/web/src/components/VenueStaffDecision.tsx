"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VenueBookingStatus } from "@spm-t5/shared";
import { approveVenueBooking, decisionActions } from "@/lib/venueBookings";

// SCRUM-38: Venue Staff approve a pending request, after a confirm step. Shown only while it is PENDING;
// the server checks again, so a stale screen just gets a clear refusal (NOT_PENDING, SLOT_IN_PAST).
export function VenueStaffDecision({ booking }: { booking: { id: string; status: VenueBookingStatus | undefined } }) {
  const router = useRouter();
  const allowed = decisionActions(booking.status);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!allowed.approve) return null;

  async function approve() {
    setBusy(true);
    setError(undefined);
    const { ok, data } = await approveVenueBooking(booking.id);
    if (ok) {
      setConfirming(false);
      router.refresh();
    } else {
      setError(data.error ?? "We couldn't complete that. Please try again.");
    }
    setBusy(false);
  }

  return (
    <section className="vb__actions">
      <h2>Decision</h2>
      {error && <div className="alert alert--error" role="alert">{error}</div>}

      {!confirming && (
        <button className="btn" type="button" onClick={() => setConfirming(true)}>Approve request</button>
      )}
      {confirming && (
        <div role="alertdialog" aria-label="Confirm approval">
          <p>Approve this request? The venue is committed to the event for the requested period.</p>
          <button className="btn" type="button" disabled={busy} onClick={approve}>
            {busy ? "Approving…" : "Yes, approve"}
          </button>{" "}
          <button className="btn btn--secondary" type="button" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
