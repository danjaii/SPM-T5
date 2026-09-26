"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { postJson } from "@/lib/api";
import { Field } from "./Field";

export function ResetPasswordForm() {
  // Supabase puts the recovery token in the URL hash of the emailed link.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.hash.slice(1)).get("access_token"));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    const { ok, data } = await postJson("/auth/reset-password", { accessToken: token, password });
    setSubmitting(false);
    if (ok) return setMessage(data.message);
    setError(data.fieldErrors?.password ?? data.error);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <h1>Choose a new password</h1>
      <p className="auth__lede">Use the link from your reset email.</p>

      {token === null && (
        <div className="alert alert--error" role="alert">This reset link is invalid or has expired. Request a new one.</div>
      )}
      {message ? (
        <>
          <div className="alert alert--ok" role="status">{message}</div>
          <Link className="btn" href="/login" style={{ textAlign: "center", textDecoration: "none" }}>Go to sign in</Link>
        </>
      ) : (
        token && (
          <>
            <Field id="password" label="New password" type="password" autoComplete="new-password"
              hint="At least 8 characters, with a letter, a number and a symbol."
              value={password} onChange={(e) => setPassword(e.target.value)} error={error} required />
            <button className="btn" type="submit" disabled={submitting}>{submitting ? "Saving…" : "Update password"}</button>
          </>
        )
      )}

      <div className="auth__links"><Link href="/login">Back to sign in</Link></div>
    </form>
  );
}
