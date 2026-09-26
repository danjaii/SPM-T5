import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** The three ways auth-service talks to Supabase. Injected into the app so tests can fake them. */
export interface SupabaseDeps {
  /** Publishable key, no user: sign-in, sign-up, password-reset email. */
  anon: SupabaseClient;
  /** Secret key, bypasses RLS: only for things a user cannot do themselves (create profile, revoke session). */
  admin: SupabaseClient;
  /** Publishable key + the caller's token: RLS-scoped reads on their behalf. */
  forUser: (accessToken: string) => SupabaseClient;
}

const stateless = { persistSession: false, autoRefreshToken: false } as const;

export function createSupabaseDeps(env: NodeJS.ProcessEnv = process.env): SupabaseDeps {
  const url = env.SUPABASE_URL;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  const secretKey = env.SUPABASE_SECRET_KEY;
  if (!url || !publishableKey || !secretKey) {
    throw new Error("SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY must be set (see README).");
  }
  return {
    anon: createClient(url, publishableKey, { auth: stateless }),
    admin: createClient(url, secretKey, { auth: stateless }),
    forUser: (accessToken) =>
      createClient(url, publishableKey, {
        auth: stateless,
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
  };
}
