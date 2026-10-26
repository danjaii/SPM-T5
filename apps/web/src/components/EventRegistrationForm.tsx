"use client";

import { CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { validateRegistrationForm } from "@spm-t5/shared";
import { RegistrationStatusBadge } from "@/components/RegistrationStatusBadge";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InputField } from "@/components/ui/input-field";
import { formatEventDateTime } from "@/lib/formatEventDateTime";
import {
  STATUS_LABELS,
  submitRegistration,
  type RegistrationFormData,
  type RegistrationStatus,
} from "@/lib/eventRegistration";

// SCRUM-83/AC3, AC4: why registration isn't open, shown instead of the form ("open" shows the form)
const UNAVAILABLE: Record<RegistrationFormData["event"]["availability"], string | null> = {
  closed: "Registration closed",
  full: "Event full",
  cancelled: "This event has been cancelled",
  open: null,
};

// SCRUM-83: the attendee's registration form for one event
export function EventRegistrationForm({ data }: { data: RegistrationFormData }) {
  const { event, prefill } = data;
  // SCRUM-83/AC8: start with the attendee's own details; each field stays editable
  const [name, setName] = useState(prefill.name);
  const [email, setEmail] = useState(prefill.email);
  const [phone, setPhone] = useState(prefill.phone);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [registered, setRegistered] = useState<{ event_name: string; status: RegistrationStatus }>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return; // SCRUM-83/AC16: one request per registration, however often Register is pressed
    setError(undefined);
    // SCRUM-83/AC9, AC10, AC11: the same rules event-service applies (packages/shared), checked before sending
    const result = validateRegistrationForm({ name, email, phone });
    setFieldErrors(result.ok ? {} : result.errors);
    if (!result.ok) return;

    setSubmitting(true);
    const { ok, data } = await submitRegistration(event.id, result.form);
    // SCRUM-83/AC14, SCRUM-139/AC2: confirm with the event's name and the new registration's status
    // (the in-app notification is the notification-service story's)
    if (ok) setRegistered(data);
    // SCRUM-83/AC17: full, closed or cancelled since the form opened (or any refusal): event-service's clear message
    else setError(data.error ?? "We couldn't register you. Please try again.");
    setSubmitting(false);
  }

  return (
    <section className="space-y-4">
      {/* SCRUM-83/AC7: the event's name, date and time, and location, as its List of events card shows them */}
      <div className="space-y-2">
        <h1 className="font-heading text-2xl font-bold text-foreground">{event.name}</h1>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
          <time dateTime={event.start_at}>{formatEventDateTime(event.start_at, event.end_at)}</time>
        </p>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin aria-hidden="true" className="size-4 shrink-0" />
          {event.venue.name ? `${event.venue.name}, ${event.venue.address}` : "Venue to be confirmed"}
        </p>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {registered && (
        // SCRUM-139/AC2: the confirmed state, with a way to the new row in My registrations
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3">
            <RegistrationStatusBadge status={registered.status} />
            <p role="status" className="text-sm font-medium text-foreground">
              {`You're registered for ${registered.event_name}. Status: ${STATUS_LABELS[registered.status]}.`}
            </p>
            <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/registrations">
              View my registrations
            </Link>
          </CardContent>
        </Card>
      )}

      {event.my_registration ? (
        // SCRUM-83/AC5: an active registration is shown instead of the form (worded as on the card, SCRUM-71/AC10)
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          Your registration:
          <RegistrationStatusBadge status={event.my_registration} />
        </p>
      ) : UNAVAILABLE[event.availability] ? (
        <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-muted-foreground">{UNAVAILABLE[event.availability]}</p>
      ) : (
        !registered && (
          <Card>
            <CardContent>
              <form className="space-y-4" onSubmit={onSubmit} noValidate>
                {/* Each field shows its own error right under its input ("an error next to the field") */}
                <InputField id="name" label="Name" autoComplete="name" value={name} error={fieldErrors.name}
                  onChange={(e) => setName(e.target.value)} />
                <InputField id="email" label="Email" type="email" autoComplete="email" value={email} error={fieldErrors.email}
                  onChange={(e) => setEmail(e.target.value)} />
                <InputField id="phone" label="Contact number" type="tel" autoComplete="tel" value={phone} error={fieldErrors.phone}
                  onChange={(e) => setPhone(e.target.value)} />
                <Button type="submit" disabled={submitting}>{submitting ? "Registering…" : "Register"}</Button>
              </form>
            </CardContent>
          </Card>
        )
      )}
    </section>
  );
}
