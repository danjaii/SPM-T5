"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { postJson } from "@/lib/api";
import { Field } from "./Field";

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
    <form onSubmit={onSubmit} noValidate>
      <h1>Reset password</h1>
      <p className="auth__lede">We will email you a link to choose a new password.</p>

      {message && <div className="alert alert--ok" role="status">{message}</div>}

      <Field id="email" label="Work email" type="email" autoComplete="username" placeholder="name@company.com"
        value={email} onChange={(e) => setEmail(e.target.value)} error={error} required />

      <button className="btn" type="submit" disabled={submitting}>{submitting ? "Sending…" : "Send reset link"}</button>

      <div className="auth__links"><Link href="/login">Back to sign in</Link></div>
    </form>
  );
}
