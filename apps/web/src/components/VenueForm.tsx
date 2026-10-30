"use client";

import { AlertCircle, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { parseVenueInput, utcToSgt, type BookingAtVenue, type VenueInput, type VenueInputField } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputField } from "@/components/ui/input-field";
import { TextareaField } from "@/components/ui/textarea-field";
import type { ApiResult } from "@/lib/api";
import { postVenue, putVenue } from "@/lib/venueCatalogue";
import type { VenueSearchOptions } from "@/lib/venueSearch";

type Errors = Partial<Record<VenueInputField, string>>;

// The error under a group of checkboxes: an icon plus text, like InputField's, and announced when it appears.
function GroupError({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} role="alert" className="flex items-center gap-1.5 text-sm font-medium text-destructive">
      <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </p>
  );
}

/** What a save answers: the venue's id, or (SCRUM-58) the bookings a capacity cut would leave over capacity. */
type Saved = ApiResult<{ id: string; code?: string; affected?: BookingAtVenue[] }>;

interface Props {
  /** The layouts and facilities to choose from (the same lists the venue search offers). */
  options: VenueSearchOptions;
  /** SCRUM-58: the venue being edited (its id, and its values to fill the form with). Absent when adding a venue. */
  venueId?: string;
  initial?: VenueInput;
  /** Replaced by a pretend service in tests; defaults to asking venue-service. */
  submit?: (body: VenueInput & { confirmImpact?: boolean }) => Promise<Saved>;
}

// 58-S4: how a booking's status reads in the list of bookings a capacity cut would leave over capacity.
const STATUS_LABEL: Record<string, string> = { requested: "Pending", tentative: "Held", approved: "Approved", confirmed: "Confirmed" };

function when(b: BookingAtVenue): string {
  const start = utcToSgt(new Date(b.eventStart));
  const end = utcToSgt(new Date(b.eventEnd));
  return `${start.date} ${start.time}–${end.time}`;
}

// SCRUM-57: Venue Staff add a venue. Validates with the same parser as venue-service (parseVenueInput), so a missing or
// invalid field is named here before anything is sent (57-S2), and whatever the server still refuses is shown on its field.
// A saved venue opens on its detail page, where it already appears in the catalogue (57-S1).
// SCRUM-58: the same form edits a venue when it is given the venue's id and values. A capacity cut that leaves a booking over
// capacity is listed first and sent again, with the confirmation, only when the user chooses Save anyway (58-S4).
export function VenueForm({ options, venueId, initial, submit }: Props) {
  const router = useRouter();
  const editing = venueId !== undefined;
  const send: NonNullable<Props["submit"]> = submit ?? (editing ? (body: VenueInput & { confirmImpact?: boolean }) => putVenue(venueId, body) : postVenue);
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [maxCapacity, setMaxCapacity] = useState(initial ? String(initial.maxCapacity) : "");
  const [start, setStart] = useState(initial?.operatingHoursStart ?? "");
  const [end, setEnd] = useState(initial?.operatingHoursEnd ?? "");
  const [isAccessible, setIsAccessible] = useState(initial?.isAccessible ?? false);
  const [accessibilityNotes, setAccessibilityNotes] = useState(initial?.accessibilityNotes ?? "");
  // A ticked layout has its own capacity (what it seats), offered as the venue's and open to change.
  const [layoutCapacity, setLayoutCapacity] = useState<Record<string, string>>(
    Object.fromEntries((initial?.layouts ?? []).map((l) => [l.layoutId, String(l.maxCapacity)])),
  );
  const [facilityIds, setFacilityIds] = useState<string[]>(initial?.facilityIds ?? []);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string>();
  const [impact, setImpact] = useState<BookingAtVenue[]>();
  const [busy, setBusy] = useState(false);

  // A message goes away as soon as the field it is about is changed; the form checks everything again on the next submit.
  // It also withdraws the list of bookings a capacity cut would affect: a confirmation must never cover a different edit.
  function fixed(...fields: VenueInputField[]) {
    setImpact(undefined);
    setErrors((current) => {
      const next = { ...current };
      for (const f of fields) delete next[f];
      return next;
    });
  }

  function toggleLayout(id: string, on: boolean) {
    fixed("layouts");
    setLayoutCapacity((current) => {
      const next = { ...current };
      if (on) next[id] = maxCapacity.trim();
      else delete next[id];
      return next;
    });
  }

  function toggleFacility(id: string) {
    fixed("facilityIds");
    setFacilityIds((current) => (current.includes(id) ? current.filter((f) => f !== id) : [...current, id]));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    return save(false);
  }

  /** `confirmed` is the user's Save anyway after being shown the bookings a capacity cut would leave over capacity (58-S4). */
  async function save(confirmed: boolean) {
    setFailure(undefined);
    setImpact(undefined);

    const parsed = parseVenueInput({
      name,
      address,
      description,
      maxCapacity,
      operatingHoursStart: start,
      operatingHoursEnd: end,
      isAccessible,
      accessibilityNotes,
      // A layout left without its own capacity seats as many as the venue holds.
      layouts: Object.entries(layoutCapacity).map(([layoutId, capacity]) => ({ layoutId, maxCapacity: capacity.trim() || maxCapacity })),
      facilityIds,
    });
    if (!parsed.ok) {
      setErrors(parsed.fieldErrors);
      return;
    }
    setErrors({});

    setBusy(true);
    const { ok, data } = await send(confirmed ? { ...parsed.data, confirmImpact: true } : parsed.data);
    setBusy(false);
    if (ok) {
      toast.success(editing ? "Venue saved" : "Venue added");
      router.push(`/venues/${editing ? venueId : data.id}`);
    } else if (data.code === "CONFIRM_IMPACT" && data.affected) {
      setImpact(data.affected);
    } else if (data.fieldErrors) {
      setErrors(data.fieldErrors as Errors);
    } else {
      setFailure(data.error ?? `We couldn't ${editing ? "save" : "add"} the venue. Please try again.`);
    }
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate aria-label={editing ? "Edit venue" : "Add a venue"}>
      {failure && <AuthAlert tone="error">{failure}</AuthAlert>}
      {hasErrors && <AuthAlert tone="error">Some details need fixing. Each one is marked below.</AuthAlert>}

      <InputField id="name" label="Name (required)" value={name} onChange={(e) => { setName(e.target.value); fixed("name"); }} error={errors.name} autoComplete="off" />
      <InputField
        id="address"
        label="Location (required)"
        value={address}
        onChange={(e) => { setAddress(e.target.value); fixed("address"); }}
        error={errors.address}
        helper="Where the venue is, for example its building and floor."
        autoComplete="off"
      />
      <TextareaField id="description" label="Description" value={description} onChange={(e) => { setDescription(e.target.value); fixed("description"); }} error={errors.description} />
      <InputField
        id="maxCapacity"
        label="Capacity (required)"
        type="text"
        inputMode="numeric"
        value={maxCapacity}
        onChange={(e) => { setMaxCapacity(e.target.value); fixed("maxCapacity"); }}
        error={errors.maxCapacity}
        helper="The most people the venue holds."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <InputField id="start" label="Opening time" type="time" value={start} onChange={(e) => { setStart(e.target.value); fixed("operatingHoursStart", "operatingHoursEnd"); }} error={errors.operatingHoursStart} />
        <InputField
          id="end"
          label="Closing time"
          type="time"
          value={end}
          onChange={(e) => { setEnd(e.target.value); fixed("operatingHoursStart", "operatingHoursEnd"); }}
          error={errors.operatingHoursEnd}
          helper="Singapore time. Leave both empty if there are no set hours."
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">Accessibility</legend>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox checked={isAccessible} onCheckedChange={(c) => { setIsAccessible(Boolean(c)); fixed("isAccessible"); }} />
          Accessible venue
        </label>
        {errors.isAccessible && <GroupError id="accessible-message">{errors.isAccessible}</GroupError>}
        <TextareaField
          id="accessibilityNotes"
          label="Accessibility notes"
          value={accessibilityNotes}
          onChange={(e) => { setAccessibilityNotes(e.target.value); fixed("accessibilityNotes"); }}
          error={errors.accessibilityNotes}
          helper="Features guests can rely on, separated by commas, for example step-free entrance, hearing loop."
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3" aria-describedby={errors.layouts ? "layouts-message" : undefined}>
        <legend className="mb-1 text-sm font-semibold text-foreground">Supported layouts (choose at least one)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {options.layouts.map((layout) => {
            const chosen = layout.id in layoutCapacity;
            return (
              <div key={layout.id} className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox checked={chosen} onCheckedChange={(c) => toggleLayout(layout.id, Boolean(c))} />
                  {layout.name}
                </label>
                {chosen && (
                  <InputField
                    id={`layout-${layout.id}`}
                    label={`Capacity for ${layout.name}`}
                    type="text"
                    inputMode="numeric"
                    value={layoutCapacity[layout.id]}
                    onChange={(e) => { setLayoutCapacity((current) => ({ ...current, [layout.id]: e.target.value })); fixed("layouts"); }}
                  />
                )}
              </div>
            );
          })}
        </div>
        {errors.layouts && <GroupError id="layouts-message">{errors.layouts}</GroupError>}
      </fieldset>

      <fieldset className="flex flex-col gap-2" aria-describedby={errors.facilityIds ? "facilities-message" : undefined}>
        <legend className="mb-1 text-sm font-semibold text-foreground">Facilities</legend>
        <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          {options.facilities.map((facility) => (
            <label key={facility.id} className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={facilityIds.includes(facility.id)} onCheckedChange={() => toggleFacility(facility.id)} />
              {facility.name}
            </label>
          ))}
        </div>
        {errors.facilityIds && <GroupError id="facilities-message">{errors.facilityIds}</GroupError>}
      </fieldset>

      {impact && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-status-warning-fg bg-status-warning p-3 text-sm text-status-warning-fg">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-3">
            <p className="font-medium">
              These bookings expect more people than the venue would hold with this capacity. Nothing is cancelled or changed for them: their
              coordinators already see them marked as over capacity.
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {impact.map((b) => (
                <li key={b.bookingId}>
                  <span className="font-medium">{b.eventName}</span>, {when(b)}, {b.expectedAttendance} people, {STATUS_LABEL[b.status] ?? b.status}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => save(true)}>
                Save anyway
              </Button>
              <Button type="button" variant="outline" onClick={() => setImpact(undefined)}>
                Keep editing
              </Button>
            </div>
          </div>
        </div>
      )}

      <Button type="submit" disabled={busy} className="self-start">
        {busy ? (editing ? "Saving…" : "Adding…") : editing ? "Save changes" : "Add venue"}
      </Button>
    </form>
  );
}
