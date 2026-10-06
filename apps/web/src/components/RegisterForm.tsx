"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { postJson } from "@/lib/api";
import { Field } from "./Field";

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
      <div>
        <h1>Create account</h1>
        <p className="auth__lede">Request access to ConnectSphere.</p>
        <div className="alert alert--ok" role="status">{success}</div>
        <Link className="btn" href="/login" style={{ textAlign: "center", textDecoration: "none" }}>Go to sign in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <h1>Create account</h1>
      <p className="auth__lede">Request access to ConnectSphere.</p>

      {formError && <div className="alert alert--error" role="alert">{formError}</div>}

      <Field id="fullName" label="Full name" autoComplete="name" value={fullName}
        onChange={(e) => setFullName(e.target.value)} error={errors.fullName} required />
      <Field id="email" label="Work email" type="email" autoComplete="username" placeholder="name@company.com"
        value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} required />
      <Field id="password" label="Password" type="password" autoComplete="new-password"
        hint="At least 8 characters, with an uppercase letter, a lowercase letter, a number and a symbol."
        value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} required />
      <Field id="confirmPassword" label="Confirm password" type="password" autoComplete="new-password"
        value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} error={errors.confirmPassword} required />

      <button className="btn" type="submit" disabled={submitting}>{submitting ? "Creating account…" : "Create account"}</button>

      <div className="auth__links">
        <span>Already registered? <Link href="/login">Sign in</Link></span>
      </div>
    </form>
  );
}
