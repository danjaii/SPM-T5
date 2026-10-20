"use client";

import { Building2, Check, Globe } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { isInternalRole, validateProfileUpdate } from "@spm-t5/shared";
import { AuthAlert } from "@/components/auth/AuthParts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { InputField } from "@/components/ui/input-field";
import type { ApiResult } from "@/lib/api";
import { saveProfile, type ProfileChanges, type ProfileView } from "@/lib/profile";
import { roleLabel } from "@/lib/roles";

interface Props {
  profile: ProfileView;
  /** Sends the changes to auth-service. Tests pass a pretend one so nothing is really sent; the real page leaves it out. */
  save?: (changes: ProfileChanges) => Promise<ApiResult<ProfileView>>;
}

type TextField = "fullName" | "email" | "phone";

const PREFERENCES = [
  { key: "email", label: "Email", name: "preferEmail" },
  { key: "sms", label: "SMS", name: "preferSms" },
] as const;

/** The first letters of the first two words of a name, for the avatar: "Rachel Tan" gives "RT". */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");

// SCRUM-68, SCRUM-69: the signed-in user's own profile (docs/specs/user-profile.md). "Your details" can be changed;
// "Your role" is set by ConnectSphere and only shown.
export function ProfileForm({ profile, save = saveProfile }: Props) {
  const [values, setValues] = useState<Record<TextField, string>>({
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone ?? "",
  });
  const [preferences, setPreferences] = useState(profile.communicationPreferences);
  const [errors, setErrors] = useState<Partial<Record<TextField, string>>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [failure, setFailure] = useState<string>();

  // SCRUM-68/AC4, AC5: when a box is left, check it with the same rules the service uses, so the person sees what is wrong before saving
  function check(field: TextField) {
    const result = validateProfileUpdate({ [field]: values[field] });
    setErrors((current) => ({ ...current, [field]: result.ok ? undefined : result.errors[field] }));
  }

  // SCRUM-68/AC6: Save with a wrong box sends nothing; every wrong box is pointed out
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setConfirmed(false);
    setFailure(undefined);
    const result = validateProfileUpdate(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});

    // SCRUM-68/AC3: everything is valid: send the details as they now are, and confirm when they are saved
    const { ok, data } = await save({ ...values, communicationPreferences: preferences });
    if (ok) setConfirmed(true);
    // the service refused (for example the email is already in use): show its message next to the box it is about
    else if (data.fieldErrors) setErrors(data.fieldErrors);
    // anything else (the database could not save, the service could not be reached): show its message at the top
    else setFailure(data.error);
  }

  const text = (field: TextField, label: string, type = "text", helper?: string) => (
    <InputField
      id={field}
      name={field}
      label={label}
      type={type}
      helper={helper}
      value={values[field]}
      onChange={(e) => setValues((current) => ({ ...current, [field]: e.target.value }))}
      onBlur={() => check(field)}
      error={errors[field]}
    />
  );

  const internal = isInternalRole(profile.role);
  const KindIcon = internal ? Building2 : Globe;

  return (
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
      {/* The part the person can change */}
      <Card>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <CardHeader>
            <CardTitle className="text-lg font-bold">Your details</CardTitle>
            <CardDescription>Change how ConnectSphere contacts you.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {failure && <AuthAlert tone="error">{failure}</AuthAlert>}
            {confirmed && <AuthAlert tone="ok">Profile updated.</AuthAlert>}
            {text("fullName", "Name")}
            {/* SCRUM-68: the contact email is not the sign-in email; when they differ, say which one the person still signs in with */}
            {text("email", "Contact email", "email", profile.email !== profile.loginEmail ? `You still sign in with ${profile.loginEmail}.` : undefined)}
            {text("phone", "Phone", "tel")}
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-sm font-semibold text-foreground">Communication preferences</legend>
              <div className="flex flex-wrap gap-3">
                {PREFERENCES.map(({ key, label, name }) => (
                  <label
                    key={key}
                    className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-border-strong bg-card px-3 text-sm font-medium has-checked:border-primary has-checked:bg-highlight has-focus-visible:ring-2 has-focus-visible:ring-ring"
                  >
                    <input
                      type="checkbox"
                      name={name}
                      className="size-4 accent-primary"
                      checked={preferences[key]}
                      onChange={(e) => setPreferences((current) => ({ ...current, [key]: e.target.checked }))}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </CardContent>
          <CardFooter className="justify-end">
            <Button type="submit">Save changes</Button>
          </CardFooter>
        </form>
      </Card>

      {/* What ConnectSphere has set for the person: shown, never edited */}
      <Card aria-labelledby="role-heading" role="region">
        <CardHeader>
          <CardTitle id="role-heading" className="text-lg font-bold">Your role</CardTitle>
          <CardDescription>Set by ConnectSphere. You can&apos;t change these here.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-full bg-highlight text-base font-bold text-fg-primary">
              {initials(profile.fullName)}
            </span>
            <div className="flex min-w-0 flex-col items-start gap-1">
              <Badge variant="info">
                <KindIcon aria-hidden="true" />
                {roleLabel(profile.role)}
              </Badge>
              <span className="text-xs font-medium text-muted-foreground">{internal ? "Internal staff" : "External user"}</span>
            </div>
          </div>
          <dl className="flex flex-col gap-4">
            {/* SCRUM-68/AC2: only Event Organisers have one */}
            {profile.organisation && <Fact label="Organisation">{profile.organisation.name}</Fact>}
            {/* SCRUM-69: only staff (internal users) have a department and responsibilities */}
            {internal && <Fact label="Department">{profile.department ?? <Missing />}</Fact>}
          </dl>
          {internal && (
            <section aria-labelledby="responsibilities-heading" className="flex flex-col gap-2">
              <h3 id="responsibilities-heading" className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Responsibilities
              </h3>
              {profile.responsibilities.length === 0 ? (
                <Missing />
              ) : (
                <ul className="flex flex-col gap-2">
                  {profile.responsibilities.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm leading-snug">
                      <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-success-fg" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-semibold text-foreground">{children}</dd>
    </div>
  );
}

const Missing = () => <span className="text-sm font-normal text-muted-foreground italic">Not recorded</span>;
