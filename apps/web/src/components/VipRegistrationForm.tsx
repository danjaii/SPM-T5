"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { validateVipEmail } from "@spm-t5/shared";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InputField } from "@/components/ui/input-field";
import { addVipRegistration } from "@/lib/eventRegistration";

// SCRUM-170: the event's organiser adds a VIP past the registration cap, by the email of their attendee account
export function VipRegistrationForm({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string>();
  const [added, setAdded] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setAdded(undefined);
    const result = validateVipEmail(email);
    setFieldError(result.ok ? undefined : result.error);
    if (!result.ok) return;

    setSubmitting(true);
    const { ok, data } = await addVipRegistration(eventId, result.email);
    if (ok) {
      setAdded(result.email);
      setEmail("");
      router.refresh(); // reload the list from the server, so the new row and the summary update
    } else {
      // SCRUM-170/AC2: event-service's reason, e.g. the venue is full. The email stays, so it can be corrected
      setError(data.error);
    }
    setSubmitting(false);
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <form className="flex flex-wrap items-start gap-3" onSubmit={onSubmit} noValidate>
          <InputField
            id="vip-email"
            className="min-w-64 flex-1"
            label="Attendee's email"
            helper="Add a VIP past the registration limit, up to the venue's capacity. They need an attendee account."
            type="email"
            value={email}
            error={fieldError}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" className="mt-7" disabled={submitting}>Add VIP</Button>
        </form>
        {error && <Alert variant="danger">{error}</Alert>}
        {added && <p role="status" className="text-sm font-medium text-foreground">{added} is now Confirmed as a VIP.</p>}
      </CardContent>
    </Card>
  );
}
