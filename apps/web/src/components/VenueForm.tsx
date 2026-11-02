"use client";

import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { parseVenueInput, type VenueInputField } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputField } from "@/components/ui/input-field";
import { TextareaField } from "@/components/ui/textarea-field";
import { postVenue } from "@/lib/venueCatalogue";
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

interface Props {
  /** The layouts and facilities to choose from (the same lists the venue search offers). */
  options: VenueSearchOptions;
  /** Replaced by a pretend service in tests; defaults to asking venue-service. */
  submit?: typeof postVenue;
}

// SCRUM-57: Venue Staff add a venue. Validates with the same parser as venue-service (parseVenueInput), so a missing or
// invalid field is named here before anything is sent (57-S2), and whatever the server still refuses is shown on its field.
// A saved venue opens on its detail page, where it already appears in the catalogue (57-S1).
export function VenueForm({ options, submit = postVenue }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [maxCapacity, setMaxCapacity] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [isAccessible, setIsAccessible] = useState(false);
  const [accessibilityNotes, setAccessibilityNotes] = useState("");
  // A ticked layout has its own capacity (what it seats), offered as the venue's and open to change.
  const [layoutCapacity, setLayoutCapacity] = useState<Record<string, string>>({});
  const [facilityIds, setFacilityIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);

  // A message goes away as soon as the field it is about is changed; the form checks everything again on the next submit.
  function fixed(...fields: VenueInputField[]) {
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFailure(undefined);

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
    const { ok, data } = await submit(parsed.data);
    setBusy(false);
    if (ok) {
      toast.success("Venue added");
      router.push(`/venues/${data.id}`);
    } else if (data.fieldErrors) {
      setErrors(data.fieldErrors as Errors);
    } else {
      setFailure(data.error ?? "We couldn't add the venue. Please try again.");
    }
  }

  const hasErrors = Object.keys(errors).length > 0;

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate aria-label="Add a venue">
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

      <Button type="submit" disabled={busy} className="self-start">
        {busy ? "Adding…" : "Add venue"}
      </Button>
    </form>
  );
}
