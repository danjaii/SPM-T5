"use client";

import { AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { parseVenueTimingInput, type AffectedPairDto } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { putVenueTiming } from "@/lib/venueTiming";

type Errors = { setupMinutes?: string; turnaroundMinutes?: string };

// SCRUM-101: Venue Staff set a venue's setup and turnaround times. Shown only to them (the server says so with
// can_edit_timing, and checks again). Validates with the same parser as venue-service, so a bad value never leaves
// the browser and the saved values stay as they were (101-S3).
// SCRUM-129/AC2: a saved edit is confirmed with a message in the form and a toast.
export function VenueTimingForm({ venueId, setupMinutes, turnaroundMinutes }: { venueId: string; setupMinutes: number; turnaroundMinutes: number }) {
  const router = useRouter();
  const [setup, setSetup] = useState(String(setupMinutes));
  const [turnaround, setTurnaround] = useState(String(turnaroundMinutes));
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string>();
  const [saved, setSaved] = useState(false);
  // SCRUM-104: what the save said about the existing bookings (the pairs that now clash, or that none do)
  const [impact, setImpact] = useState<{ message: string; affected: AffectedPairDto[] }>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    setImpact(undefined);
    setFailure(undefined);

    const parsed = parseVenueTimingInput({ setupMinutes: setup, turnaroundMinutes: turnaround });
    if (!parsed.ok) {
      setErrors(parsed.fieldErrors);
      return;
    }
    setErrors({});

    setBusy(true);
    const { ok, data } = await putVenueTiming(venueId, parsed.data);
    setBusy(false);
    if (ok) {
      setSaved(true);
      setImpact({ message: data.message, affected: data.affected ?? [] });
      toast.success("Venue saved");
      router.refresh();
    } else if (data.fieldErrors) {
      setErrors(data.fieldErrors);
    } else {
      setFailure(data.error ?? "We couldn't save the times. Please try again.");
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-label="Setup and turnaround times">
      {failure && <AuthAlert tone="error">{failure}</AuthAlert>}
      {saved && (
        <AuthAlert tone="ok">
          {/* 104-S1, 104-S6: which existing bookings now clash, or that none do */}
          The times were saved. {impact?.message}
        </AuthAlert>
      )}
      {saved && impact && impact.affected.length > 0 && (
        <div
          aria-label="Bookings that now conflict"
          className="flex items-start gap-2 rounded-lg border border-status-warning-fg bg-status-warning p-3 text-sm text-status-warning-fg"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-2">
            <p className="font-medium">
              These bookings are flagged &ldquo;Buffer conflict&rdquo;. Nothing was cancelled or withdrawn: their coordinators can see the flag
              and resolve it.
            </p>
            <ul className="list-disc pl-4">
              {impact.affected.map((p) => (
                <li key={`${p.first.bookingId}-${p.second.bookingId}`}>{p.summary}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <InputField
        id="setupMinutes"
        label="Setup time (minutes)"
        type="text"
        inputMode="numeric"
        value={setup}
        onChange={(e) => setSetup(e.target.value)}
        error={errors.setupMinutes}
        helper="Time the venue team needs before an event."
      />
      <InputField
        id="turnaroundMinutes"
        label="Turnaround time (minutes)"
        type="text"
        inputMode="numeric"
        value={turnaround}
        onChange={(e) => setTurnaround(e.target.value)}
        error={errors.turnaroundMinutes}
        helper="Time the venue team needs after an event."
      />
      <Button type="submit" disabled={busy} className="self-start">
        {busy ? "Saving…" : "Save times"}
      </Button>
    </form>
  );
}
