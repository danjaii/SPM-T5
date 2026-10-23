"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-bold">Actions</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        {error && <AuthAlert tone="error">{error}</AuthAlert>}

        {allowed.withdraw && !confirming && (
          <Button type="button" variant="outline" onClick={() => setConfirming(true)}>Withdraw request</Button>
        )}
        {allowed.withdraw && confirming && (
          <div role="alertdialog" aria-label="Confirm withdrawal" className="flex flex-col gap-3 rounded-lg border border-border-strong p-3 text-sm">
            <p>Withdraw this request? Venue Staff will no longer assess it and the venue slot is released.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="destructive" disabled={busy} onClick={() => run(() => withdrawVenueBooking(booking.id), false)}>
                {busy ? "Withdrawing…" : "Yes, withdraw"}
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
                Keep request
              </Button>
            </div>
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
          <Button type="button" disabled={busy} onClick={() => run(() => acceptVenueSuggestion(booking.id), true)}>
            {busy ? "Accepting…" : "Accept suggested alternative"}
          </Button>
        )}

        {/* SCRUM-107/AC1: only for a booking flagged as unavailable, and not while a replacement is waiting */}
        {allowed.findReplacement && (
          <Link className={buttonVariants()} href={`/venue-bookings/${booking.id}/replacement`}>Find replacement</Link>
        )}

        {allowed.amend && (
          <Link className={buttonVariants({ variant: "outline" })} href={`/venue-bookings/${booking.id}/amend`}>Amend request</Link>
        )}
      </CardContent>
    </Card>
  );
}
