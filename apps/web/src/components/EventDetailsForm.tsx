"use client";

import { AlertCircle, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  EVENT_NAME_MAX_LENGTH,
  EVENT_TEXT_MAX_LENGTH,
  eventDetailsFromFormValues,
  parseEventDetailsInput,
  type AffectedArrangement,
  type EventDetailsFormValues,
} from "@spm-t5/shared";
import { EventImpactWarning } from "@/components/EventImpactWarning";
import { EventSection } from "@/components/event/EventSection";
import { InlineMessage } from "@/components/event/InlineMessage";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveEventDetails, type EventEditForm } from "@/lib/events";

type Key = keyof EventDetailsFormValues;

/** The marker on an important field (AC2): it may affect venue or equipment arrangements. */
const IMPORTANT_NOTE = "Important: may affect venue or equipment arrangements";

/** The Select cannot hold an empty value, so "no choice" travels as this and is stored as "". */
const NONE = "none";

// SCRUM-111: the assigned coordinator edits an event's planning information. Ordinary and important fields are shown in two
// cards, and each important field is marked (AC2). The shared rules check the form before it is sent (AC3), and saving
// goes back to the event page, which says it was saved (AC5). SCRUM-112: an important change that affects venue bookings or
// equipment requests is shown first in a dialog, and saved only on Save anyway.
// SCRUM-128/AC1-AC3: the same behaviour in the redesigned layout (shadcn cards, fields and dialog).
export function EventDetailsForm({ eventId, form }: { eventId: string; form: EventEditForm }) {
  const router = useRouter();
  const [values, setValues] = useState<EventDetailsFormValues>(form.values);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [impact, setImpact] = useState<{ message: string; affected: AffectedArrangement[] }>();

  // SCRUM-112: a different edit may affect different arrangements, so any change closes the warning
  const change = (key: Key, value: string) => {
    setImpact(undefined);
    setValues((v) => ({ ...v, [key]: value }));
  };
  const important = (key: Key) => form.importantFields.includes(key);
  const helper = (key: Key) => (important(key) ? IMPORTANT_NOTE : undefined);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    // the same rules as event-service, against the details the form started from
    const parsed = parseEventDetailsInput(values, eventDetailsFromFormValues(form.values), new Date());
    if (!parsed.ok) {
      setFieldErrors(parsed.fieldErrors);
      if (parsed.noChanges) setError("Nothing was changed.");
      return;
    }
    setFieldErrors({});
    await send(false);
  }

  /** Saves the edit; `confirmImpact` is SCRUM-112's Save anyway. */
  async function send(confirmImpact: boolean) {
    setSaving(true);
    const { ok, data } = await saveEventDetails(eventId, confirmImpact ? { ...values, confirmImpact: true } : values);
    if (ok) {
      router.push(`/events/${eventId}?saved=1`);
      return;
    }
    setSaving(false);
    if (data.code === "CONFIRM_IMPACT" && data.affected) {
      setImpact({ message: data.error ?? "This change may affect existing arrangements.", affected: data.affected });
      return;
    }
    setImpact(undefined);
    if (data.fieldErrors) setFieldErrors(data.fieldErrors);
    setError(data.error ?? "We couldn't save the event details. Please try again.");
  }

  const text = (key: Key, label: string, type = "text", max?: number) => (
    <InputField
      id={key}
      label={label}
      type={type}
      value={String(values[key])}
      maxLength={max}
      helper={helper(key)}
      error={fieldErrors[key]}
      onChange={(e) => change(key, e.target.value)}
    />
  );

  /** A labelled box for long text; its note and error are tied to it for screen readers. */
  const area = (key: Key, label: string) => {
    const messageId = `${key}-message`;
    const message = fieldErrors[key] ?? helper(key);
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={key} className="text-sm font-semibold text-foreground">{label}</label>
        <Textarea
          id={key}
          rows={3}
          value={String(values[key])}
          maxLength={EVENT_TEXT_MAX_LENGTH}
          aria-invalid={fieldErrors[key] ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          onChange={(e) => change(key, e.target.value)}
        />
        {message && (
          <p id={messageId} className={fieldErrors[key] ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}>{message}</p>
        )}
      </div>
    );
  };

  const choice = (key: Key, label: string, options: { id: string; name: string }[]) => {
    const items = [{ value: NONE, label: "None" }, ...options.map((o) => ({ value: o.id, label: o.name }))];
    return (
      <div className="flex flex-col gap-1.5">
        <span id={`${key}-label`} className="text-sm font-semibold text-foreground">{label}</span>
        <Select items={items} value={String(values[key]) || NONE} onValueChange={(v) => change(key, !v || v === NONE ? "" : v)}>
          <SelectTrigger id={key} className="w-full" aria-labelledby={`${key}-label`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {fieldErrors[key] ? (
          <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
            {fieldErrors[key]}
          </p>
        ) : (
          helper(key) && <p className="text-sm text-muted-foreground">{helper(key)}</p>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">Edit event details</h1>
        <p className="text-sm text-muted-foreground">{form.values.name}</p>
      </div>
      {error && <InlineMessage kind="error">{error}</InlineMessage>}

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <EventSection id="event-details-heading" title="Event details">
          <div className="flex flex-col gap-4">
            {text("name", "Event name", "text", EVENT_NAME_MAX_LENGTH)}
            {area("description", "Description")}
            {area("purpose", "Purpose")}
            {choice("categoryId", "Category", form.categories)}
          </div>
        </EventSection>

        <EventSection
          id="important-details-heading"
          title="Important details"
          action={
            <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Lock aria-hidden="true" className="size-4" />
              Affects bookings
            </span>
          }
        >
          <p className="text-sm text-muted-foreground">Changing these may affect the event&apos;s venue bookings and equipment requests.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("date", "Date", "date")}
            {text("startTime", "Start time", "time")}
            {text("endDate", "End date", "date")}
            {text("endTime", "End time", "time")}
            {text("expectedAttendance", "Expected attendance", "number")}
            {choice("roomLayoutId", "Room layout", form.roomLayouts)}
          </div>
          {area("accessibilityRequirements", "Accessibility needs")}
          {area("venueRequirements", "Venue requirements")}
          {area("equipmentRequirements", "Equipment requirements")}
        </EventSection>

        <div>
          <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
        </div>
      </form>

      <EventImpactWarning
        open={Boolean(impact)}
        message={impact?.message ?? ""}
        affected={impact?.affected ?? []}
        saving={saving}
        onConfirm={() => send(true)}
        onCancel={() => setImpact(undefined)}
      />
    </div>
  );
}
