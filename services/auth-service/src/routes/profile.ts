import { Router } from "express";
import { isInternalRole, isRole, validateProfileUpdate } from "@spm-t5/shared";
import type { SupabaseDeps } from "../supabase";
import { requireSession, type SessionUser } from "../middlewares/session";

const EMAIL_IN_USE = "That email address is already in use.";
const SAVE_FAILED = "We couldn't save your profile. Please try again.";

/**
 * SCRUM-68: a signed-in user's own profile (docs/specs/user-profile.md). Reading uses the caller's own token, so RLS applies.
 * Saving uses the secret key: users.email is deliberately not writable by a signed-in user (03_users_role_privilege.sql).
 * The update is limited to the caller's own row and to the fields the shared rules accept.
 */
export function profileRoutes(deps: SupabaseDeps) {
  const router = Router();

  /** The profile as the page shows it: name, contact email, login email, phone, preferences, role and (organisers) organisation. */
  async function readProfile({ id, email, token }: SessionUser) {
    const db = deps.forUser(token);
    const { data: profile } = await db
      .from("users")
      .select("full_name, role, organisation_id, department")
      .eq("id", id)
      .maybeSingle();
    // SCRUM-154/AC5: email, phone and preferences are not readable from users (migration 52); the caller's own come from a function
    const { data: contact } = await db.rpc("my_contact_details");
    const mine = (contact as { email: string; phone: string | null; communication_preferences: unknown }[] | null)?.[0];

    // SCRUM-68/AC2: only an Event Organiser has an organisation; they see its name
    let organisation: { name: string } | null = null;
    if (profile?.role === "event_organiser" && profile.organisation_id) {
      const { data: found } = await db.from("organisations").select("name").eq("id", profile.organisation_id).maybeSingle();
      if (found) organisation = { name: found.name };
    }

    // SCRUM-69: only internal users have a department and responsibilities to show; for everyone else they are empty.
    // The responsibilities are stored once for each role (role_responsibilities), not for each person.
    const internal = isRole(profile?.role) && isInternalRole(profile.role);
    let responsibilities: string[] = [];
    if (internal) {
      const { data: rows } = await db
        .from("role_responsibilities")
        .select("description")
        .eq("role", profile?.role)
        .order("position", { ascending: true });
      responsibilities = (rows ?? []).map((row) => row.description as string);
    }

    return {
      fullName: profile?.full_name,
      email: mine?.email,
      loginEmail: email,
      phone: mine?.phone ?? null,
      communicationPreferences: mine?.communication_preferences,
      role: profile?.role,
      organisation,
      department: internal ? (profile?.department ?? null) : null,
      responsibilities,
    };
  }

  // SCRUM-68/AC1: name, contact email, phone, preferences and role
  router.get("/", requireSession(deps), async (_req, res) => {
    res.json(await readProfile(res.locals.user as SessionUser));
  });

  // SCRUM-68/AC3: save a change to the name, contact email, phone or preferences, and answer with the profile as it is now
  router.patch("/", requireSession(deps), async (req, res) => {
    const user = res.locals.user as SessionUser;
    const checked = validateProfileUpdate(req.body);
    if (!checked.ok) return res.status(422).json({ fieldErrors: checked.errors });

    const { fullName, email, phone, communicationPreferences } = checked.update;
    const changes = {
      ...(fullName !== undefined && { full_name: fullName }),
      ...(email !== undefined && { email }),
      ...(phone !== undefined && { phone }),
      ...(communicationPreferences !== undefined && { communication_preferences: communicationPreferences }),
    };
    const { error } = await deps.admin.from("users").update(changes).eq("id", user.id);
    // SCRUM-68: users.email is unique (Postgres error 23505): another profile already has this address
    if (error?.code === "23505") return res.status(409).json({ error: EMAIL_IN_USE, fieldErrors: { email: EMAIL_IN_USE } });
    // anything else that stopped the save: say so plainly, never answer as if it worked
    if (error) return res.status(500).json({ error: SAVE_FAILED });

    res.json(await readProfile(user));
  });

  return router;
}
