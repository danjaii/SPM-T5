"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { AuthAlert, AuthHeader, AuthLink } from "@/components/auth/AuthParts";
import { Button, buttonVariants } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { postJson } from "@/lib/api";
import { cn } from "@/lib/utils";

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
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AuthHeader title="Choose a new password" lede="Use the link from your reset email." />

      {token === null && <AuthAlert tone="error">This reset link is invalid or has expired. Request a new one.</AuthAlert>}
      {message ? (
        <>
          <AuthAlert tone="ok">{message}</AuthAlert>
          <Link href="/login" className={cn(buttonVariants({ size: "lg" }), "w-full")}>Go to sign in</Link>
        </>
      ) : (
        token && (
          <>
            <InputField id="password" name="password" label="New password" type="password" autoComplete="new-password"
              helper="At least 8 characters, with a letter, a number and a symbol."
              value={password} onChange={(e) => setPassword(e.target.value)} error={error} required />
            <Button type="submit" size="lg" disabled={submitting} className="w-full">
              {submitting ? (<><Loader2 aria-hidden="true" className="animate-spin" />Saving…</>) : "Update password"}
            </Button>
          </>
        )
      )}

      <AuthLink href="/login" className="text-sm">Back to sign in</AuthLink>
    </form>
  );
}
