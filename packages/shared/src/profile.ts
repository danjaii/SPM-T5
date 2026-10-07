import { z } from "zod";
import { PHONE_PATTERN } from "./registration";

// SCRUM-68: the profile page's rules (docs/specs/user-profile.md), shared by auth-service and apps/web so both check the same way.

const PREFERENCE_ERROR = "Choose on or off for email and SMS.";

export const profileUpdateSchema = z.object({
  // SCRUM-68/AC5: required when sent; spaces alone don't count
  fullName: z.string().trim().min(1, "Name is required.").optional(),
  // SCRUM-68/AC5: required when sent; spaces alone don't count
  // SCRUM-68/AC4: must look like an email address; kept in lower case, as sign-in does
  email: z.string().trim().toLowerCase().min(1, "Email is required.").email("Enter a valid email address.").optional(),
  // SCRUM-68/AC4: the same number rule as the registration form. The phone is optional: an empty box means no phone (null).
  phone: z
    .string()
    .trim()
    .refine((value) => value === "" || PHONE_PATTERN.test(value), "Enter a valid contact number.")
    .transform((value) => (value === "" ? null : value))
    .optional(),
  // SCRUM-68/AC3: how the user wants to be contacted; each is on or off
  communicationPreferences: z
    .object({
      email: z.boolean({ required_error: PREFERENCE_ERROR, invalid_type_error: PREFERENCE_ERROR }),
      sms: z.boolean({ required_error: PREFERENCE_ERROR, invalid_type_error: PREFERENCE_ERROR }),
    })
    .optional(),
})
// SCRUM-68/AC7, AC8: only the fields above can be changed; anything else (role, organisation, department...) is refused
.strict();

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** SCRUM-68/AC5: checks a submitted profile. On failure, one message per field, to show next to that field. */
export function validateProfileUpdate(
  input: unknown,
): { ok: true; update: ProfileUpdate } | { ok: false; errors: Record<string, string> } {
  const parsed = profileUpdateSchema.safeParse(input);
  if (parsed.success) return { ok: true, update: parsed.data };

  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) errors[key] = "This can't be changed.";
      continue;
    }
    const field = String(issue.path[0]);
    if (!errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}
