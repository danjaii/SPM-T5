import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** How notification-service talks to Supabase. Passed into the app so tests can plug in a fake instead. */
export interface SupabaseDeps {
  /** Publishable key, no user: used to check who a login token belongs to. */
  anon: SupabaseClient;
  /** Publishable key + the caller's token: queries run as that user, so RLS applies. */
  forUser: (accessToken: string) => SupabaseClient;
}

const stateless = { persistSession: false, autoRefreshToken: false } as const;

export function createSupabaseDeps(env: NodeJS.ProcessEnv = process.env): SupabaseDeps {
  const url = env.SUPABASE_URL;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set (see README).");
  }
  return {
    anon: createClient(url, publishableKey, { auth: stateless }),
    forUser: (accessToken) =>
      createClient(url, publishableKey, {
        auth: stateless,
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
  };
}
