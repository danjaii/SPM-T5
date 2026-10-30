"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sgtToUtc, utcToSgt } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { setHoldExpiry } from "@/lib/venueBookings";

const sgt = (iso: string) => {
  const at = utcToSgt(new Date(iso));
  return `${at.date} ${at.time}`;
};

// SCRUM-97/AC1, AC7: Venue Staff set the expiry of a pending request (a tentative hold) when they receive it, and can extend or
// shorten it while it is live. Once it has passed the hold is over: the coordinator submits a new request (Week 9 Q26).
export function HoldExpiryForm({ bookingId, current }: { bookingId: string; current: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  if (current && new Date(current).getTime() <= Date.now()) {
    return (
      <section aria-labelledby="hold-expiry-heading" className="mt-6 flex flex-col gap-2 border-t border-border pt-4">
        <h2 id="hold-expiry-heading" className="text-lg font-bold text-foreground">Hold expiry</h2>
        <p className="text-sm text-muted-foreground">This hold expired {sgt(current)} (Singapore time). The venue is no longer reserved, so a new venue request is needed.</p>
      </section>
    );
  }

  async function save() {
    setSaved(false);
    if (!value) {
      setError("Choose an expiry date and time.");
      return;
    }
    const [date, time] = value.split("T");
    setError(undefined);
    setBusy(true);
    const { ok, data } = await setHoldExpiry(bookingId, sgtToUtc(date, time.slice(0, 5)).toISOString());
    setBusy(false);
    if (ok) {
      setSaved(true);
      router.refresh();
    } else {
      setError(data.fieldErrors?.expiresAt ?? data.error ?? "We couldn't save the expiry. Please try again.");
    }
  }

  return (
    <section aria-labelledby="hold-expiry-heading" className="mt-6 flex flex-col gap-3 border-t border-border pt-4">
      <h2 id="hold-expiry-heading" className="text-lg font-bold text-foreground">Hold expiry</h2>
      <p className="text-sm text-muted-foreground">
        {current ? `Expires ${sgt(current)} (Singapore time).` : "No expiry set. The hold lasts until it is decided or withdrawn."}
      </p>
      {error && <AuthAlert tone="error">{error}</AuthAlert>}
      {saved && <p role="status" className="text-sm font-medium text-foreground">Expiry saved. The event&apos;s coordinator has been told.</p>}
      <div className="flex flex-wrap items-end gap-3">
        <InputField id="hold-expires" label="Hold expires" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
        <Button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save expiry"}</Button>
      </div>
    </section>
  );
}
