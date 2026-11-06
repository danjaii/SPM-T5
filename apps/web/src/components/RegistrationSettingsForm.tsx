"use client";

import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { parseRegistrationSettings, type RegistrationSettingsField } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { fromLocalInput, saveRegistrationSettings, toLocalInput, type RegistrationSettingsView } from "@/lib/registrationSettings";

type Errors = Partial<Record<RegistrationSettingsField, string>>;

// SCRUM-185/AC4: the assigned coordinator adjusts an event's registration capacity and window, for instance while a venue block has
// returned the event to Planning. Shown only to them (the page asks event-service, which checks again, and so does the database).
// It validates with the same parser as event-service. Times are entered and shown in Singapore time.
export function RegistrationSettingsForm({ eventId, settings }: { eventId: string; settings: RegistrationSettingsView }) {
  const router = useRouter();
  const [capacity, setCapacity] = useState(settings.capacity === null ? "" : String(settings.capacity));
  const [opens, setOpens] = useState(toLocalInput(settings.opensAt));
  const [closes, setCloses] = useState(toLocalInput(settings.closesAt));
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaved(undefined);
    setFailure(undefined);

    const parsed = parseRegistrationSettings(
      { registration_capacity: capacity, registration_opens_at: fromLocalInput(opens), registration_closes_at: fromLocalInput(closes) },
      settings.eventStart,
    );
    if (!parsed.ok) {
      setErrors(parsed.fieldErrors);
      return;
    }
    setErrors({});

    setBusy(true);
    const { ok, data } = await saveRegistrationSettings(eventId, parsed.data);
    setBusy(false);
    if (ok) {
      const message = data.message ?? "Registration settings saved.";
      setSaved(message);
      toast.success(message);
      router.refresh();
    } else if (data.fieldErrors && !data.fieldErrors.form) {
      setErrors(data.fieldErrors);
    } else {
      setFailure(data.fieldErrors?.form ?? data.error ?? "We couldn't save the registration settings. Please try again.");
    }
  }

  const confirmed = settings.confirmedCount;
  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate aria-label="Registration settings">
      {settings.closedByStatus && (
        <p role="note" className="flex items-start gap-2 rounded-lg border border-status-info-fg bg-status-info p-3 text-sm text-status-info-fg">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {`Registration is closed while this event is ${settings.status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}. It opens again, within the window below, once the event is Confirmed. Existing registrations are kept.`}
        </p>
      )}
      {failure && <AuthAlert tone="error">{failure}</AuthAlert>}
      {saved && <AuthAlert tone="ok">{saved}</AuthAlert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <InputField
          id="registrationCapacity"
          label="Capacity"
          type="number"
          min={1}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          error={errors.registration_capacity}
          helper={`${confirmed} ${confirmed === 1 ? "attendee is" : "attendees are"} confirmed; the capacity can't be lower than that.`}
        />
        <InputField id="registrationOpens" label="Registration opens" type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} error={errors.registration_opens_at} />
        <InputField id="registrationCloses" label="Registration closes" type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} error={errors.registration_closes_at} />
      </div>
      <p className="text-sm text-muted-foreground">All times are Singapore time.</p>
      <Button type="submit" disabled={busy} className="self-start">{busy ? "Saving…" : "Save registration settings"}</Button>
    </form>
  );
}
