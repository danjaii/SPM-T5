import { ROLES } from "@spm-t5/shared";
import { z } from "zod";

// US2: minimum 8 characters, with a letter, a number and a symbol.
export const PASSWORD_RULE_MESSAGE =
  "Password must be at least 8 characters and include a letter, a number and a symbol.";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");

const password = z
  .string()
  .min(8, PASSWORD_RULE_MESSAGE)
  .regex(/[A-Za-z]/, PASSWORD_RULE_MESSAGE)
  .regex(/[0-9]/, PASSWORD_RULE_MESSAGE)
  .regex(/[^A-Za-z0-9]/, PASSWORD_RULE_MESSAGE);

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
  role,
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
