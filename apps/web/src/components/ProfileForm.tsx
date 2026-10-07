"use client";

import { useState, type FormEvent } from "react";
import { validateProfileUpdate } from "@spm-t5/shared";
import { Field } from "./Field";
import type { ApiResult } from "@/lib/api";
import { saveProfile, type ProfileChanges, type ProfileView } from "@/lib/profile";
import { roleLabel } from "@/lib/roles";

interface Props {
  profile: ProfileView;
  /** Sends the changes to auth-service. Tests pass a pretend one so nothing is really sent; the real page leaves it out. */
  save?: (changes: ProfileChanges) => Promise<ApiResult<ProfileView>>;
}

type TextField = "fullName" | "email" | "phone";

// SCRUM-68: the signed-in user's own profile (docs/specs/user-profile.md): their details to edit, and their role as plain text.
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

  const text = (field: TextField, label: string, type = "text", hint?: string) => (
    <Field
      id={field}
      label={label}
      type={type}
      hint={hint}
      value={values[field]}
      onChange={(e) => setValues((current) => ({ ...current, [field]: e.target.value }))}
      onBlur={() => check(field)}
      error={errors[field]}
    />
  );

  return (
    <form className="profile-form" onSubmit={onSubmit} noValidate>
      {failure && (
        <div className="alert alert--error" role="alert">
          {failure}
        </div>
      )}
      {confirmed && (
        <div className="alert alert--ok" role="status">
          Profile updated.
        </div>
      )}
      {text("fullName", "Name")}
      {/* SCRUM-68: the contact email is not the sign-in email; when they differ, say which one the person still signs in with */}
      {text("email", "Contact email", "email", profile.email !== profile.loginEmail ? `You still sign in with ${profile.loginEmail}.` : undefined)}
      {text("phone", "Phone", "tel")}
      <fieldset className="profile-form__preferences">
        <legend>Communication preferences</legend>
        <label>
          <input
            type="checkbox"
            name="preferEmail"
            checked={preferences.email}
            onChange={(e) => setPreferences((current) => ({ ...current, email: e.target.checked }))}
          />{" "}
          Email
        </label>
        <label>
          <input
            type="checkbox"
            name="preferSms"
            checked={preferences.sms}
            onChange={(e) => setPreferences((current) => ({ ...current, sms: e.target.checked }))}
          />{" "}
          SMS
        </label>
      </fieldset>
      <dl className="profile-form__facts">
        <dt>Role</dt>
        <dd>{roleLabel(profile.role)}</dd>
        {/* SCRUM-68/AC2: only Event Organisers have one; it is shown, never edited */}
        {profile.organisation && (
          <>
            <dt>Organisation</dt>
            <dd>{profile.organisation.name}</dd>
          </>
        )}
      </dl>
      <button className="btn" type="submit">
        Save changes
      </button>
    </form>
  );
}
