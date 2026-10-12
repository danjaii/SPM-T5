import { Router } from "express";
import type { SupabaseDeps } from "../supabase";
import { SESSION_COOKIE, readCookie, requireSession, sessionCookieOptions, type SessionUser } from "../middlewares/session";
import {
  fieldErrors,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "../validation";

// US1: one message for every login failure, so the response never reveals which part was wrong.
export const INVALID_LOGIN_MESSAGE = "Invalid email, password or role.";

const webOrigin = () => process.env.WEB_ORIGIN ?? "http://localhost:3000";

export function authRoutes(deps: SupabaseDeps) {
  const { anon, admin, forUser } = deps;
  const router = Router();

  // US1 — Login
  router.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter your email, password and role." });
    const { email, password, role } = parsed.data;

    const { data, error } = await anon.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) return res.status(401).json({ error: INVALID_LOGIN_MESSAGE });

    const { data: profile } = await forUser(data.session.access_token)
      .from("users")
      .select("full_name, role, is_active")
      .eq("id", data.user.id)
      .maybeSingle();

    // Unknown profile, deactivated account and wrong role all look like a wrong password.
    if (!profile || !profile.is_active || profile.role !== role) {
      await admin.auth.admin.signOut(data.session.access_token, "local").catch(() => undefined);
      return res.status(401).json({ error: INVALID_LOGIN_MESSAGE });
    }

    res.cookie(SESSION_COOKIE, data.session.access_token, sessionCookieOptions(data.session.expires_in));
    return res.json({
      user: { id: data.user.id, email: data.user.email, fullName: profile.full_name, role: profile.role },
      redirectTo: `/dashboard/${profile.role}`,
    });
  });

  // US2 — Register
  router.post("/register", async (req, res) => {

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) });
    }
    const { fullName, email, password } = parsed.data;
    const duplicate = { error: "An account with this email already exists.", fieldErrors: { email: "An account with this email already exists." } };

    const { data: existing } = await admin.from("users").select("id").eq("email", email).maybeSingle();
    if (existing) return res.status(409).json(duplicate);

    const { data, error } = await anon.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${webOrigin()}/login` },
    });
    // With email confirmation on, Supabase hides duplicates by returning a user with no identities.
    if (error?.message.toLowerCase().includes("already") || data.user?.identities?.length === 0) {
      return res.status(409).json(duplicate);
    }
    // Supabase's built-in email sender only allows a few messages per hour; say so instead of "try again".
    if (error?.status === 429 || error?.code === "over_email_send_rate_limit") {
      return res.status(429).json({ error: "Too many verification emails have been sent recently. Please wait a while and try again." });
    }
    // SCRUM-12/AC13: anything else Supabase reports is a system error, not the user's input.
    if (error || !data.user) return res.status(500).json({ error: "We couldn't create your account. Please try again." });

    // SCRUM-12: self sign-up always creates an Attendee. role can't be set by the user themselves
    // (03_users_role_privilege.sql), so the profile is written with the secret key.
    const { error: profileError } = await admin
      .from("users")
      .insert({ id: data.user.id, role: "attendee", full_name: fullName, email });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      return res.status(500).json({ error: "We couldn't create your account. Please try again." });
    }

    return res.status(201).json({
      message: data.session
        ? "Registration successful. You can now sign in."
        : "Registration successful. Check your email to verify your account, then sign in.",
    });
  });

  // US1 — password reset: always the same reply, so it can't be used to discover which emails exist.
  router.post("/forgot-password", async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address.", fieldErrors: fieldErrors(parsed.error) });
    const { error } = await anon.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: `${webOrigin()}/reset-password` });
    // The reply stays generic either way (see above); log so a failed send isn't silent.
    if (error) console.warn(`forgot-password: reset email not sent (${error.code ?? error.status}): ${error.message}`);
    return res.json({ message: "If an account exists for that email, we've sent a link to reset the password." });
  });

  router.post("/reset-password", async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) });
    const { data, error } = await anon.auth.getUser(parsed.data.accessToken);
    if (error || !data.user) return res.status(400).json({ error: "This reset link is invalid or has expired." });
    const { error: updateError } = await admin.auth.admin.updateUserById(data.user.id, { password: parsed.data.password });
    if (updateError) return res.status(400).json({ error: "We couldn't update your password. Please try again." });
    return res.json({ message: "Password updated. You can now sign in." });
  });

  // US3 — who am I (used by the web app's route guard)
  router.get("/me", requireSession(deps), (_req, res) => {
    const { id, email, fullName, role } = res.locals.user as SessionUser;
    res.json({ id, email, fullName, role });
  });

  // US4 — Logout: revoke this session on Supabase, then drop the cookie.
  router.post("/logout", async (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await admin.auth.admin.signOut(token, "local").catch(() => undefined);
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
    res.json({ ok: true });
  });

  return router;
}
