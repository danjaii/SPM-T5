import type { SupabaseClient } from "@supabase/supabase-js";

/** How event-service talks to Supabase. Passed into the app so tests can plug in a fake instead. */
export interface SupabaseDeps {
  /** Publishable key, no user: used to check who a login token belongs to. */
  anon: SupabaseClient;
  /** Publishable key + the caller's token: queries run as that user, so RLS applies. */
  forUser: (accessToken: string) => SupabaseClient;
}
