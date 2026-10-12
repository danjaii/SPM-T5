import { ROLES } from "@spm-t5/shared";
import { z } from "zod";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");

// SCRUM-12/AC5: minimum 8 characters, with an uppercase letter, a lowercase letter, a number and a symbol.
// SCRUM-12/AC6: each rule has its own message, so the user knows which one failed.
const password = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .regex(/[A-Z]/, "Password must include an uppercase letter.")
  .regex(/[a-z]/, "Password must include a lowercase letter.")
  .regex(/[0-9]/, "Password must include a number.")
  .regex(/[^A-Za-z0-9]/, "Password must include a symbol.");

const role = z.enum(ROLES, { errorMap: () => ({ message: "Choose a role." }) });

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
  role,
});

export const registerSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your full name."),
  email,
  password,
  confirmPassword: z.string().min(1, "Confirm your password."),
  // SCRUM-12/AC10: self sign-up is attendee-only; asking for any other role is refused, not ignored.
  role: z.literal("attendee", { errorMap: () => ({ message: "You can only register as an attendee." }) }).optional(),
}).refine((form) => form.password === form.confirmPassword, {
  message: "Passwords do not match.",
  path: ["confirmPassword"],
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z.object({
  accessToken: z.string().min(1),
  password,
});

/** First message per field, for showing next to the form input. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
