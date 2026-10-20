"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthAlert, AuthHeader, AuthLink } from "@/components/auth/AuthParts";
import { Button, buttonVariants } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { postJson } from "@/lib/api";
import { cn } from "@/lib/utils";

export function RegisterForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    setFormError(undefined);
    setSubmitting(true);
    const { ok, data } = await postJson("/auth/register", { fullName, email, password, confirmPassword });
    setSubmitting(false);
    if (ok) return setSuccess(data.message ?? "Registration successful.");
    // SCRUM-12/AC8: keep the name and email, but never leave a password sitting in the form after a failure.
    setPassword("");
    setConfirmPassword("");
    setErrors(data.fieldErrors ?? {});
    if (!data.fieldErrors) setFormError(data.error);
  }

  if (success) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeader title="Create account" lede="Request access to ConnectSphere." />
        <AuthAlert tone="ok">{success}</AuthAlert>
        <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "w-full")}>Go to sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AuthHeader title="Create account" lede="Request access to ConnectSphere." />

      {formError && <AuthAlert tone="error">{formError}</AuthAlert>}

      <InputField id="fullName" name="fullName" label="Full name" autoComplete="name" value={fullName}
        onChange={(e) => setFullName(e.target.value)} error={errors.fullName} required />
      <InputField id="email" name="email" label="Work email" type="email" autoComplete="username" placeholder="name@company.com"
        value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} required />
      <InputField id="password" name="password" label="Password" type="password" autoComplete="new-password"
        helper="At least 8 characters, with an uppercase letter, a lowercase letter, a number and a symbol."
        value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} required />
      <InputField id="confirmPassword" name="confirmPassword" label="Confirm password" type="password" autoComplete="new-password"
        value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} error={errors.confirmPassword} required />

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? (<><Loader2 aria-hidden="true" className="animate-spin" />Creating account…</>) : "Create account"}
      </Button>

      <p className="text-sm text-muted-foreground">Already registered? <AuthLink href="/login">Sign in</AuthLink></p>
    </form>
  );
}
