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

export type Actor = { client: SupabaseClient; userId: string };

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
  return { client, userId: data.user.id };
}
