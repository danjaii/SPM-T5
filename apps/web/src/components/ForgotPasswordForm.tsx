"use client";

import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { AuthAlert, AuthHeader, AuthLink } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { postJson } from "@/lib/api";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    const { ok, data } = await postJson("/auth/forgot-password", { email });
    setSubmitting(false);
    if (ok) return setMessage(data.message);
    setError(data.fieldErrors?.email ?? data.error);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AuthHeader title="Reset password" lede="We will email you a link to choose a new password." />

      {message && <AuthAlert tone="ok">{message}</AuthAlert>}

      <InputField id="email" name="email" label="Work email" type="email" autoComplete="username" placeholder="name@company.com"
        value={email} onChange={(e) => setEmail(e.target.value)} error={error} required />

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? (<><Loader2 aria-hidden="true" className="animate-spin" />Sending…</>) : "Send reset link"}
      </Button>

      <AuthLink href="/login" className="text-sm">Back to sign in</AuthLink>
    </form>
  );
}
