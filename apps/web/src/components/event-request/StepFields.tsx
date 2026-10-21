"use client";

import { ACCESSIBILITY_OPTIONS, type EventRequestFormValues } from "@/lib/eventRequestForm";
import type { RoomLayoutOption } from "@/lib/eventRequests";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { FormField } from "@/components/ui/form-field";
import { InputField } from "@/components/ui/input-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  step: number;
  values: EventRequestFormValues;
  errors: Record<string, string>;
  layouts: RoomLayoutOption[];
  onChange: (patch: Partial<EventRequestFormValues>) => void;
  /** SCRUM-49/AC3: called with the request field's name when the organiser leaves a box. */
  onBlurField: (field: string) => void;
}

// SCRUM-123/AC2: each required box has a label with its helper text, and shows its own error beside it when the step is
// left incomplete. Errors are keyed by the request field event-service uses, so the form and the API name fields alike.
export function StepFields({ step, values: v, errors, layouts, onChange, onBlurField }: Props) {
  switch (step) {
    case 0:
      return (
        <div className="flex flex-col gap-5">
          <InputField id="name" label="Event name *" helper="The name attendees will see." value={v.name}
            error={errors.name} onBlur={() => onBlurField("name")} onChange={(e) => onChange({ name: e.target.value })} />
          <FormField id="purpose" label="Purpose" required helper="Why you are holding this event." error={errors.purpose}>
            {(c) => <Textarea {...c} rows={3} value={v.purpose} onBlur={() => onBlurField("purpose")} onChange={(e) => onChange({ purpose: e.target.value })} />}
          </FormField>
          <FormField id="description" label="Description" required helper="What happens, and who it is for." error={errors.description}>
            {(c) => <Textarea {...c} rows={4} value={v.description} onBlur={() => onBlurField("description")} onChange={(e) => onChange({ description: e.target.value })} />}
          </FormField>
        </div>
      );
    case 1:
      return (
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <InputField id="start" type="datetime-local" label="Starts *" helper="Singapore time." value={v.start}
              error={errors.preferred_start_datetime} onBlur={() => onBlurField("preferred_start_datetime")} onChange={(e) => onChange({ start: e.target.value })} />
            <InputField id="end" type="datetime-local" label="Ends *" helper="Singapore time." value={v.end}
              error={errors.preferred_end_datetime} onBlur={() => onBlurField("preferred_end_datetime")} onChange={(e) => onChange({ end: e.target.value })} />
          </div>
          <InputField id="attendance" type="number" inputMode="numeric" min={1} label="Expected attendance *"
            helper="How many people you expect, as a whole number." value={v.attendance}
            error={errors.expected_attendance} onBlur={() => onBlurField("expected_attendance")} onChange={(e) => onChange({ attendance: e.target.value })} />
        </div>
      );
    case 2:
      return (
        <div className="flex flex-col gap-5">
          <FormField id="venueRequirements" label="Venue requirements" required error={errors.venue_requirements}
            helper="Location, facilities and anything your coordinator should know. They find and book the venue; you do not pick a room.">
            {(c) => <Textarea {...c} rows={3} value={v.venueRequirements} onBlur={() => onBlurField("venue_requirements")} onChange={(e) => onChange({ venueRequirements: e.target.value })} />}
          </FormField>
          <FormField id="layout" label="Room layout" required helper="How the room should be set out." error={errors.preferred_room_layout_id}>
            {(c) => (
              <Select value={v.layoutId || null} onValueChange={(id) => onChange({ layoutId: id ?? "" })}
                onOpenChange={(open) => { if (!open) onBlurField("preferred_room_layout_id"); }}
                items={layouts.map((l) => ({ value: l.id, label: l.name }))}>
                <SelectTrigger {...c} className="w-full sm:w-72">
                  <SelectValue placeholder="Choose a layout" />
                </SelectTrigger>
                <SelectContent>
                  {layouts.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold text-foreground">Accessibility needs</legend>
            <p className="text-sm text-muted-foreground">Choose any that apply. Leave all off if none are needed.</p>
            <div className="flex flex-wrap gap-2">
              {ACCESSIBILITY_OPTIONS.map((option) => (
                <ChoiceChip key={option} label={option} pressed={v.accessibility.includes(option)}
                  onPressedChange={(on) => onChange({ accessibility: on ? [...v.accessibility, option] : v.accessibility.filter((o) => o !== option) })} />
              ))}
            </div>
          </fieldset>
          <FormField id="accessibilityNotes" label="Other accessibility needs (optional)" error={errors.accessibility_requirements}>
            {(c) => <Textarea {...c} rows={2} value={v.accessibilityNotes} onChange={(e) => onChange({ accessibilityNotes: e.target.value })} />}
          </FormField>
        </div>
      );
    case 3:
      return (
        <FormField id="equipment" label="Equipment requirements" required error={errors.equipment_requirements_notes}
          helper='Audio-visual, furniture and technical needs. Enter "None required" if there are none.'>
          {(c) => <Textarea {...c} rows={4} value={v.equipment} onBlur={() => onBlurField("equipment_requirements_notes")} onChange={(e) => onChange({ equipment: e.target.value })} />}
        </FormField>
      );
    default:
      return (
        <div className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2" aria-describedby={errors.registration_required ? "registrationRequired-message" : undefined}>
            <legend className="text-sm font-semibold text-foreground">Do attendees need to register? *</legend>
            <div className="flex flex-wrap gap-2">
              <ChoiceChip label="Yes, registration needed" pressed={v.registrationRequired === "yes"}
                onPressedChange={(on) => onChange({ registrationRequired: on ? "yes" : "" })} />
              <ChoiceChip label="No registration" pressed={v.registrationRequired === "no"}
                onPressedChange={(on) => onChange({ registrationRequired: on ? "no" : "" })} />
            </div>
            {errors.registration_required ? (
              <p id="registrationRequired-message" className="text-sm font-medium text-destructive">{errors.registration_required}</p>
            ) : null}
          </fieldset>
          {v.registrationRequired === "yes" ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <InputField id="registrationCapacity" type="number" inputMode="numeric" min={1} label="Registration capacity *"
                helper="The most people who can sign up." value={v.registrationCapacity} error={errors.registration_capacity}
                onBlur={() => onBlurField("registration_capacity")} onChange={(e) => onChange({ registrationCapacity: e.target.value })} className="sm:col-span-2" />
              <InputField id="registrationOpens" type="datetime-local" label="Registration opens *" helper="Singapore time."
                value={v.registrationOpens} error={errors.registration_opens_at}
                onBlur={() => onBlurField("registration_opens_at")} onChange={(e) => onChange({ registrationOpens: e.target.value })} />
              <InputField id="registrationCloses" type="datetime-local" label="Registration closes *" helper="By the event start."
                value={v.registrationCloses} error={errors.registration_closes_at}
                onBlur={() => onBlurField("registration_closes_at")} onChange={(e) => onChange({ registrationCloses: e.target.value })} />
            </div>
          ) : null}
        </div>
      );
  }
}
