"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Role } from "@spm-t5/shared";
import { postJson } from "@/lib/api";
import { Field } from "./Field";
import { RolePicker } from "./RolePicker";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("event_coordinator");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    const { ok, data } = await postJson<{ redirectTo: string }>("/auth/login", { email, password, role });
    if (ok) {
      // replace, so "Back" from the dashboard never returns to a filled-in sign-in form
      router.replace(data.redirectTo);
      return;
    }
    setError(data.error ?? "Invalid email, password or role.");
    setSubmitting(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <h1>Sign in</h1>
      <p className="auth__lede">Use your organisation account.</p>

      {error && <div className="alert alert--error" role="alert">{error}</div>}

      <Field id="email" label="Work email" type="email" autoComplete="username" placeholder="name@company.com"
        value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Field id="password" label="Password" type="password" autoComplete="current-password"
        value={password} onChange={(e) => setPassword(e.target.value)} required />

      <RolePicker legend="Continue as" value={role} onChange={setRole} />

      <button className="btn" type="submit" disabled={submitting}>{submitting ? "Signing in…" : "Sign in"}</button>

      <div className="auth__links">
        <Link href="/forgot-password">Forgot password</Link>
        <span>Client organisation? <Link href="/register">Request access</Link></span>
      </div>
    </form>
  );
}
