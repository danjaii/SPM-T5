"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Role } from "@spm-t5/shared";
import { postJson } from "@/lib/api";
import { Field } from "./Field";
import { RolePicker } from "./RolePicker";

/** SCRUM-83/AC2: only a path on this site; "//host" and "/\host" are other sites to a browser (an open redirect). */
function isSafePath(path: string | undefined): path is string {
  return !!path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
}

interface Props {
  /** SCRUM-83/AC2: where to go after signing in (e.g. the registration form a guest selected), instead of the dashboard. */
  next?: string;
}

export function LoginForm({ next }: Props = {}) {
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
      router.replace(isSafePath(next) ? next : data.redirectTo);
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
        <span>New here? <Link href="/register">Create an attendee account</Link></span>
      </div>
    </form>
  );
}
