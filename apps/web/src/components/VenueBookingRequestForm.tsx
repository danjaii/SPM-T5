"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { exceedsCapacity, parseVenueBookingInput, VENUE_REQUIREMENTS_MAX_LENGTH, type UnmetRequirement } from "@spm-t5/shared";
import { AlertTriangle } from "lucide-react";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { InputField } from "@/components/ui/input-field";
import { SuitabilityCheck } from "./SuitabilityCheck";
import { UnsuitableConfirm } from "./UnsuitableConfirm";
import {
  submitVenueBooking,
  type VenueBookingFormData,
  type VenueBookingInputBody,
  type VenueOption,
} from "@/lib/venueBookings";

// The native select keeps its keyboard and mobile pickers; the classes match the shadcn Input beside it.
const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive";

type Slot = Omit<VenueBookingInputBody, "eventId">;

interface Props {
  form: VenueBookingFormData;
  venues: VenueOption[];
  /** SCRUM-60: start from the rejected request's slot and submit as an amendment instead. */
  initial?: Partial<Slot>;
  heading?: string;
  submitLabel?: string;
  submit?: (input: Slot) => ReturnType<typeof submitVenueBooking>;
}

// SCRUM-32/AC2: the coordinator picks a venue, date and time; the event's own details are shown read-only.
// Validation is the shared parseVenueBookingInput, so the form and venue-service agree (32-S5).
// SCRUM-98/AC2: this venue booking can have its own expected attendance and venue requirements (blank means the event's),
// and the form warns, without blocking, when the chosen venue holds fewer people than expected (98-S10).
export function VenueBookingRequestForm({ form, venues, initial, heading, submitLabel, submit }: Props) {
  const router = useRouter();
  const [venueId, setVenueId] = useState(initial?.venueId ?? "");
  const [date, setDate] = useState(initial?.date ?? form.date ?? "");
  const [startTime, setStartTime] = useState(initial?.startTime ?? form.startTime ?? "");
  const [endTime, setEndTime] = useState(initial?.endTime ?? form.endTime ?? "");
  const [ownAttendance, setOwnAttendance] = useState("");
  const [ownRequirements, setOwnRequirements] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  // SCRUM-110: set when venue-service says the venue does not suit the booking; the request is not created until confirmed
  const [unsuitable, setUnsuitable] = useState<{ unmet: UnmetRequirement[]; input: Slot }>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);

    const parsed = parseVenueBookingInput(
      {
        venueId, date, startTime, endTime,
        // blank means "use the event's", so it is left out (98-S7)
        expectedAttendance: ownAttendance.trim() === "" ? undefined : Number(ownAttendance),
        venueRequirements: ownRequirements,
      },
      new Date(),
    );
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      return;
    }
    setFieldErrors({});

    const input: Slot = { venueId, date, startTime, endTime };
    if (parsed.data.expectedAttendance !== undefined) input.expectedAttendance = parsed.data.expectedAttendance;
    if (parsed.data.venueRequirements !== undefined) input.venueRequirements = parsed.data.venueRequirements;

    await send(input);
  }

  async function send(input: Slot) {
    setSaving(true);
    const { ok, data } = await (submit ?? ((slot) => submitVenueBooking({ eventId: form.eventId, ...slot })))(input);
    if (ok) {
      router.push(`/venue-bookings/${data.id}`);
      return;
    }
    if (data.code === "UNSUITABLE_VENUE" && data.unmet) {
      // 110-S2: ask before creating anything; 110-S5: a SLOT_CONFLICT never gets here, it is shown as an error below
      setUnsuitable({ unmet: data.unmet, input });
    } else {
      if (data.fieldErrors) setFieldErrors(data.fieldErrors);
      setError(data.error ?? "We couldn't submit the request. Please try again.");
    }
    setSaving(false);
  }

  // 98-S10: the venue booking's own attendance if a valid one is typed, the event's if not
  const typed = Number(ownAttendance);
  const attendance = ownAttendance.trim() !== "" && Number.isInteger(typed) && typed >= 1 ? typed : form.expectedAttendance;
  const chosen = venues.find((v) => v.id === venueId);
  const tooSmall = chosen && exceedsCapacity(attendance, chosen.max_capacity) ? chosen : undefined;

  return (
    <section className="mx-auto w-full max-w-xl">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">{heading ?? "Request a venue"}</h1>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">{form.eventName}</p>

      {error && <div className="mb-4"><AuthAlert tone="error">{error}</AuthAlert></div>}

      <Card className="p-6">
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-status-info p-3 text-sm text-status-info-fg">
            <dt className="font-semibold">Expected attendance</dt>
            <dd>{form.expectedAttendance ?? "Not specified"}</dd>
            <dt className="font-semibold">Venue requirements</dt>
            <dd>{form.venueRequirements || "None specified"}</dd>
            <dt className="font-semibold">Accessibility needs</dt>
            <dd>{form.accessibilityNeeds || "None specified"}</dd>
          </dl>

          <FormField id="venueId" label="Venue" error={fieldErrors.venueId}>
            {(control) => (
              <select {...control} className={SELECT_CLASS} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                <option value="">Choose a venue</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}{v.max_capacity != null ? ` (capacity ${v.max_capacity})` : ""}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {tooSmall && (
            <p className="flex items-start gap-2 rounded-lg bg-status-warning p-3 text-sm font-medium text-status-warning-fg" role="status">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {`${tooSmall.name} holds ${tooSmall.max_capacity} people, but ${attendance} are expected. You can still submit: venue staff will see this when they decide.`}
            </p>
          )}
          <InputField id="date" name="date" label="Date" type="date" value={date} error={fieldErrors.date} onChange={(e) => setDate(e.target.value)} />
          <div className="grid grid-cols-2 gap-4">
            <InputField id="startTime" name="startTime" label="Start time" type="time" value={startTime} error={fieldErrors.startTime} onChange={(e) => setStartTime(e.target.value)} />
            <InputField id="endTime" name="endTime" label="End time" type="time" value={endTime} error={fieldErrors.endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
          <InputField id="expectedAttendance" name="expectedAttendance" label="Expected attendance for this venue" type="number" min={1} step={1}
            value={ownAttendance} error={fieldErrors.expectedAttendance}
            helper={`Leave blank to use the event's: ${form.expectedAttendance ?? "not specified"}`}
            onChange={(e) => setOwnAttendance(e.target.value)} />
          <InputField id="venueRequirements" name="venueRequirements" label="Venue requirements for this venue" maxLength={VENUE_REQUIREMENTS_MAX_LENGTH}
            value={ownRequirements} error={fieldErrors.venueRequirements}
            helper={`Leave blank to use the event's: ${form.venueRequirements || "none specified"}`}
            onChange={(e) => setOwnRequirements(e.target.value)} />

          {/* SCRUM-109: information before requesting; it does not stop the request. */}
          <SuitabilityCheck eventId={form.eventId} venueId={venueId} date={date} startTime={startTime} endTime={endTime}
            attendance={ownAttendance.trim() !== "" && Number.isInteger(typed) && typed >= 1 ? typed : undefined}
            venueRequirements={ownRequirements.trim() || undefined} />

          {unsuitable ? (
            <UnsuitableConfirm
              unmet={unsuitable.unmet}
              busy={saving}
              onCancel={() => setUnsuitable(undefined)}
              onConfirm={(overrideReason) => send({ ...unsuitable.input, overrideReason })}
            />
          ) : (
            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>{saving ? "Submitting…" : (submitLabel ?? "Submit request")}</Button>
            </div>
          )}
        </form>
      </Card>
    </section>
  );
}
