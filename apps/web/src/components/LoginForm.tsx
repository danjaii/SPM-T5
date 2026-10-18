"use client";

import { AlertCircle, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { isRole, type Role } from "@spm-t5/shared";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/input-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { postJson } from "@/lib/api";
import { ROLE_OPTIONS } from "@/lib/roles";

/** SCRUM-83/AC2: only a path on this site; "//host" and "/\host" are other sites to a browser (an open redirect). */
function isSafePath(path: string | undefined): path is string {
  return !!path && path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\");
}

interface Props {
  /** SCRUM-83/AC2: where to go after signing in (e.g. the registration form a guest selected), instead of the dashboard. */
  next?: string;
}

const ROLE_ITEMS = ROLE_OPTIONS.map((r) => ({ value: r.value, label: r.label }));

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
    // SCRUM-122/AC2: the email stays as typed; only the password is cleared so the user retypes just that
    setError(data.error ?? "Invalid email, password or role.");
    setPassword("");
    setSubmitting(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Sign in</h1>
        <p className="text-sm text-muted-foreground">Use your ConnectSphere or organisation account.</p>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive bg-status-danger p-3 text-sm font-medium text-status-danger-fg">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="relative">
        <Mail aria-hidden="true" className="pointer-events-none absolute bottom-3 left-3 size-4 text-muted-foreground" />
        <InputField id="email" name="email" label="Work email" type="email" autoComplete="username" placeholder="name@company.com"
          className="[&_input]:pl-9" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="relative">
        <Lock aria-hidden="true" className="pointer-events-none absolute bottom-3 left-3 size-4 text-muted-foreground" />
        <InputField id="password" name="password" label="Password" type="password" autoComplete="current-password"
          className="[&_input]:pl-9" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </div>

      <div className="flex flex-col gap-1.5">
        <label id="role-label" htmlFor="role" className="text-sm font-semibold text-foreground">Continue as</label>
        <Select items={ROLE_ITEMS} value={role} onValueChange={(v) => isRole(v) && setRole(v)}>
          <SelectTrigger id="role" aria-labelledby="role-label" className="h-10 w-full bg-card px-3 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLE_ITEMS.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? (<><Loader2 aria-hidden="true" className="animate-spin" />Signing in…</>) : "Sign in"}
      </Button>

      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
        <Link href="/forgot-password" className="font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">Forgot password?</Link>
        <Link href="/register" className="font-semibold text-fg-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">Create an attendee account</Link>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p>Attendees can create an account when registering for an event. Staff accounts are created by ConnectSphere.</p>
      </div>
    </form>
  );
}
