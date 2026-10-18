"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { UnsuitableConfirm } from "./UnsuitableConfirm";
import type { UnmetRequirement } from "@spm-t5/shared";
import {
  acceptVenueSuggestion,
  bookingActions,
  withdrawVenueBooking,
  type VenueBookingDetailView,
} from "@/lib/venueBookings";

// SCRUM-35 / SCRUM-60 / SCRUM-59: the actions on a request, shown only where they are allowed.
// The server checks every one of them again, so a stale screen just gets a clear refusal.
export function VenueBookingActions({ booking }: { booking: VenueBookingDetailView }) {
  const router = useRouter();
  const allowed = bookingActions(booking);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // SCRUM-110: the suggested venue does not suit the booking; accepted only after a reason
  const [unsuitable, setUnsuitable] = useState<UnmetRequirement[]>();

  if (!allowed.withdraw && !allowed.amend && !allowed.acceptSuggestion && !allowed.findReplacement) return null;

  async function run(action: () => Promise<{ ok: boolean; data: { id?: string; error?: string; code?: string; unmet?: UnmetRequirement[] } }>, goToNew: boolean) {
    setBusy(true);
    setError(undefined);
    const { ok, data } = await action();
    if (ok) {
      if (goToNew && data.id) router.push(`/venue-bookings/${data.id}`);
      else router.refresh();
      setConfirming(false);
    } else if (data.code === "UNSUITABLE_VENUE" && data.unmet) {
      setUnsuitable(data.unmet);
    } else {
      setError(data.error ?? "We couldn't complete that. Please try again.");
    }
    setBusy(false);
  }

  return (
    <section className="vb__actions">
      <h2>Actions</h2>
      {error && <div className="alert alert--error" role="alert">{error}</div>}

      {allowed.withdraw && !confirming && (
        <button className="btn" type="button" onClick={() => setConfirming(true)}>Withdraw request</button>
      )}
      {allowed.withdraw && confirming && (
        <div role="alertdialog" aria-label="Confirm withdrawal">
          <p>Withdraw this request? Venue Staff will no longer assess it and the venue slot is released.</p>
          <button className="btn" type="button" disabled={busy} onClick={() => run(() => withdrawVenueBooking(booking.id), false)}>
            {busy ? "Withdrawing…" : "Yes, withdraw"}
          </button>{" "}
          <button className="btn btn--secondary" type="button" disabled={busy} onClick={() => setConfirming(false)}>
            Keep request
          </button>
        </div>
      )}

      {unsuitable && (
        <UnsuitableConfirm
          unmet={unsuitable}
          busy={busy}
          onCancel={() => setUnsuitable(undefined)}
          onConfirm={(reason) => {
            setUnsuitable(undefined);
            return run(() => acceptVenueSuggestion(booking.id, reason), true);
          }}
        />
      )}

      {allowed.acceptSuggestion && booking.suggestion && !unsuitable && (
        <p>
          <button className="btn" type="button" disabled={busy} onClick={() => run(() => acceptVenueSuggestion(booking.id), true)}>
            {busy ? "Accepting…" : "Accept suggested alternative"}
          </button>
        </p>
      )}

      {/* SCRUM-107/AC1: only for a booking flagged as unavailable, and not while a replacement is waiting */}
      {allowed.findReplacement && (
        <p>
          <Link className="btn" href={`/venue-bookings/${booking.id}/replacement`}>Find replacement</Link>
        </p>
      )}

      {allowed.amend && (
        <p>
          <Link className="btn btn--secondary" href={`/venue-bookings/${booking.id}/amend`}>Amend request</Link>
        </p>
      )}
    </section>
  );
}
