"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HOLD_WARNING_DEFAULT_MINUTES } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { setHoldWarning } from "@/lib/venueBookings";

// SCRUM-108/AC1: the event's coordinator chooses, for this hold, how many hours before it expires they are warned.
export function HoldWarningForm({ bookingId, minutes }: { bookingId: string; minutes?: number }) {
  const router = useRouter();
  const [hours, setHours] = useState(String(Math.round((minutes ?? HOLD_WARNING_DEFAULT_MINUTES) / 60)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaved(false);
    const wanted = Number(hours);
    if (hours.trim() === "" || !Number.isInteger(wanted) || wanted < 1) {
      setError("Enter a whole number of hours, 1 or more.");
      return;
    }
    setError(undefined);
    setBusy(true);
    const { ok, data } = await setHoldWarning(bookingId, wanted * 60);
    setBusy(false);
    if (ok) {
      setSaved(true);
      router.refresh();
    } else {
      setError(data.fieldErrors?.minutes ?? data.error ?? "We couldn't save the warning time. Please try again.");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <AuthAlert tone="error">{error}</AuthAlert>}
      {saved && <p role="status" className="text-sm font-medium text-foreground">Warning time saved.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <InputField id={`hold-warning-${bookingId}`} label="Warn me this many hours before the hold expires" type="number" min={1} step={1} value={hours} onChange={(e) => setHours(e.target.value)} />
        <Button type="button" variant="outline" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save warning time"}</Button>
      </div>
    </div>
  );
}
