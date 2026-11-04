"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { liftVenueUnavailability } from "@/lib/venueUnavailability";

// SCRUM-185/AC2: Venue Staff lift an unavailable period from the venue page. Shown only to them (the server says so with
// can_mark_unavailable, and checks again, and so does the database). It asks first, then venue-service removes the block, clears
// the flags it raised and tells each affected booking's coordinator; the page then reloads without the block.
export function LiftVenueBlock({ venueId, blockId, period }: { venueId: string; blockId: string; period: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function lift() {
    setBusy(true);
    setError(undefined);
    const { ok, data } = await liftVenueUnavailability(venueId, blockId);
    setBusy(false);
    if (ok) {
      setConfirming(false);
      toast.success(data.message ?? "Unavailable period lifted.");
      router.refresh();
    } else {
      setError(data.error ?? "We couldn't lift the unavailable period. Please try again.");
    }
  }

  if (!confirming) {
    return (
      <Button variant="outline" size="sm" aria-label={`Lift block ${period}`} onClick={() => setConfirming(true)}>
        Lift block
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-label="Confirm lifting this block" className="flex flex-col gap-3 rounded-lg border border-border-strong p-3 text-sm">
      <p className="font-semibold text-foreground">Lift this block?</p>
      <p className="text-muted-foreground">Coordinators with affected bookings will be told.</p>
      {error && <AuthAlert tone="error">{error}</AuthAlert>}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
          Keep block
        </Button>
        <Button size="sm" disabled={busy} onClick={lift}>
          Yes, lift block
        </Button>
      </div>
    </div>
  );
}
