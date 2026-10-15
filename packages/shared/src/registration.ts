import { z } from "zod";

// SCRUM-83: the event registration form's rules, shared by event-service and apps/web so both check the same way.

/** An optional +, then 8 to 15 digits, with single spaces or hyphens allowed between them. Also used by the profile (SCRUM-68). */
export const PHONE_PATTERN = /^\+?(?:\d[\s-]?){7,14}\d$/;

export const registrationFormSchema = z.object({
  // SCRUM-83/AC10: required; spaces alone don't count
  name: z.string().trim().min(1, "Name is required."),
  // SCRUM-83/AC11: must look like an email address
  email: z.string().trim().email("Enter a valid email address."),
  // SCRUM-83/AC10: required; spaces alone don't count
  // SCRUM-83/AC11: an optional +, then 8 to 15 digits, with single spaces or hyphens allowed between them
  phone: z
    .string()
    .trim()
    .min(1, "Contact number is required.")
    .regex(PHONE_PATTERN, "Enter a valid contact number."),
});

export type RegistrationForm = z.infer<typeof registrationFormSchema>;

/** SCRUM-83: a registration's status in the words the attendee sees. */
export type RegistrationStatus = "pending" | "confirmed" | "rejected" | "withdrawn";

// The registration_status enum has no Pending/Confirmed/Rejected, so (the mapping agreed for SCRUM-71):
// waitlisted is Pending, registered is Confirmed, cancelled is Rejected
const REGISTRATION_STATUSES: Record<string, RegistrationStatus> = {
  waitlisted: "pending",
  registered: "confirmed",
  cancelled: "rejected",
  withdrawn: "withdrawn",
};

/** SCRUM-83: a registration_status from the database in the attendee's words (undefined if it isn't one). */
export function registrationStatus(dbStatus: unknown): RegistrationStatus | undefined {
  return typeof dbStatus === "string" ? REGISTRATION_STATUSES[dbStatus] : undefined;
}

/** SCRUM-83/AC10: checks a submitted form. On failure, one message per field, to show next to that field. */
export function validateRegistrationForm(
  input: unknown,
): { ok: true; form: RegistrationForm } | { ok: false; errors: Record<string, string> } {
  const parsed = registrationFormSchema.safeParse(input);
  if (parsed.success) return { ok: true, form: parsed.data };

  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0]);
    if (!errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}

/**
 * SCRUM-73/AC7: whether a registration's attendee gets the event's updates and reminders. notification-service
 * doesn't send any yet; this is the rule it uses to pick an event's recipients.
 */
export function receivesEventUpdates(status: RegistrationStatus): boolean {
  // Only an active registration: a Withdrawn one gets nothing more
  return status === "pending" || status === "confirmed";
}
