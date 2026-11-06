import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Integration tests run against a real Postgres (local `supabase start`, or the CI job).
 * They need SUPABASE_URL and SUPABASE_SECRET_KEY (the service-role key, test setup only: it bypasses
 * RLS to arrange fixtures) and SUPABASE_PUBLISHABLE_KEY (to sign in as seeded users, so RLS applies).
 * Without them the suites skip instead of failing.
 */
export const DB_ENV = {
  url: process.env.SUPABASE_URL,
  secretKey: process.env.SUPABASE_SECRET_KEY,
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
};
export const hasDb = Boolean(DB_ENV.url && DB_ENV.secretKey && DB_ENV.publishableKey);

const stateless = { persistSession: false, autoRefreshToken: false };

export function adminClient(): SupabaseClient {
  return createClient(DB_ENV.url!, DB_ENV.secretKey!, { auth: stateless });
}

/** Password every seeded user shares (supabase/seed.sql). */
export const SEED_PASSWORD = "ConnectSphere2026!";

/** `token` is the user's access token, for calling the service's routes as them (the login cookie). */
export type Actor = { client: SupabaseClient; userId: string; token: string };

/** Signs in as a seeded user and returns a client that queries as them, so RLS applies. */
export async function signInAs(email: string): Promise<Actor> {
  const { data, error } = await createClient(DB_ENV.url!, DB_ENV.publishableKey!, { auth: stateless }).auth.signInWithPassword({
    email,
    password: SEED_PASSWORD,
  });
  if (error || !data.session) throw new Error(`Could not sign in as ${email} (run supabase db reset): ${error?.message}`);
  const client = createClient(DB_ENV.url!, DB_ENV.publishableKey!, {
    auth: stateless,
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  return { client, userId: data.user.id, token: data.session.access_token };
}

/**
 * SCRUM-195/AC3: one cleanup step that says when it fails. supabase-js returns `{ error }` instead of throwing, so a failed
 * delete used to leave test rows behind silently, and those rows then broke the next run. Throwing in afterAll makes vitest
 * report the file as failed, naming the table and the reason.
 */
export async function cleanUp(what: string, step: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await step;
  if (error) throw new Error(`${what}: could not remove the test rows: ${error.message}`);
}

/** SCRUM-195/AC4: how long an afterAll cleanup may take. Vitest's default of 10 s ran out under the whole suite's load. */
export const CLEANUP_TIMEOUT_MS = 60_000;

/**
 * SCRUM-195/AC7: the first step of removing a test's own accounts, run at the start of its cleanup. Submitting a request
 * notifies every active Event Coordinator Lead (migration 65), so a temporary Lead deleted while another file submits made
 * that submit fail (23503: its notification pointed at a user that no longer existed). Deactivating first takes the account
 * out of every "active" list well before deleteTestUsers removes it; it also unlinks coordinators from it.
 */
export async function deactivateTestUsers(admin: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await cleanUp("users", admin.from("users").update({ is_active: false, supervising_lead_id: null }).in("id", ids));
}

/** SCRUM-195/AC7: the last step: delete the test's own accounts (the users row goes with the auth user), checked. */
export async function deleteTestUsers(admin: SupabaseClient, ids: string[]): Promise<void> {
  for (const id of ids) await cleanUp(`auth user ${id}`, admin.auth.admin.deleteUser(id));
}
