import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Integration tests run against a real Postgres (local `supabase start`, or the CI job).
 * They need SUPABASE_URL and SUPABASE_SECRET_KEY (the service-role/secret key, test setup only:
 * it bypasses RLS to arrange fixtures). Without them the suites skip instead of failing.
 * Suites that exercise RLS as a real user also need SUPABASE_PUBLISHABLE_KEY (the anon/publishable
 * key, `PUBLISHABLE_KEY` in `supabase status -o env`) to sign in and build user-scoped clients.
 */
export const DB_ENV = {
  url: process.env.SUPABASE_URL,
  secretKey: process.env.SUPABASE_SECRET_KEY,
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
};
export const hasDb = Boolean(DB_ENV.url && DB_ENV.secretKey);

export function adminClient(): SupabaseClient {
  return createClient(DB_ENV.url!, DB_ENV.secretKey!, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Password every seeded user shares (supabase/seed.sql). */
export const SEED_PASSWORD = "ConnectSphere2026!";

/** Signs in as a seeded user and returns a client that queries as them, so RLS applies. */
export async function signInAs(email: string): Promise<{ client: SupabaseClient; userId: string }> {
  if (!DB_ENV.publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY must be set for RLS tests (see README).");
  const stateless = { persistSession: false, autoRefreshToken: false };
  const { data, error } = await createClient(DB_ENV.url!, DB_ENV.publishableKey, { auth: stateless }).auth.signInWithPassword({
    email,
    password: SEED_PASSWORD,
  });
  if (error || !data.session) throw new Error(`Could not sign in as ${email} (run supabase db reset): ${error?.message}`);
  const client = createClient(DB_ENV.url!, DB_ENV.publishableKey, {
    auth: stateless,
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  return { client, userId: data.user.id };
}

/** Creates throwaway venues/events (prefixed "IT-") and deletes them, and their bookings, afterwards. */
export class Fixtures {
  private venueIds: string[] = [];
  private eventIds: string[] = [];
  private organiserId?: string;

  constructor(readonly db: SupabaseClient) {}

  private async organiser(): Promise<string> {
    if (!this.organiserId) {
      const { data, error } = await this.db.from("users").select("id").eq("role", "event_organiser").limit(1).single();
      if (error) throw new Error(`Need a seeded event_organiser (run supabase db reset): ${error.message}`);
      this.organiserId = data.id as string;
    }
    return this.organiserId;
  }

  async venue(name = "IT-venue"): Promise<string> {
    const { data, error } = await this.db
      .from("venues")
      .insert({ name: `${name}-${Math.random().toString(36).slice(2, 8)}`, address: "1 Test Road", max_capacity: 100 })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    this.venueIds.push(data.id as string);
    return data.id as string;
  }

  async event(status = "approved", coordinatorId?: string, organiserId?: string): Promise<string> {
    const { data, error } = await this.db
      .from("events")
      .insert({
        name: `IT-event-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: organiserId ?? (await this.organiser()),
        assigned_coordinator_id: coordinatorId ?? null,
        status,
        is_draft: false,
        expected_attendance: 50,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    this.eventIds.push(data.id as string);
    return data.id as string;
  }

  async cleanup(): Promise<void> {
    if (this.eventIds.length) {
      // Amendments reference earlier rows, so clear that link before deleting.
      await this.db.from("venue_bookings").update({ amends_booking_id: null }).in("event_id", this.eventIds);
      await this.db.from("venue_bookings").delete().in("event_id", this.eventIds);
      await this.db.from("events").delete().in("id", this.eventIds);
    }
    if (this.venueIds.length) await this.db.from("venues").delete().in("id", this.venueIds);
  }
}
