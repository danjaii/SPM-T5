import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Integration tests run against a real Postgres (local `supabase start`, or the CI job). They need SUPABASE_URL and
 * SUPABASE_SECRET_KEY (the service-role key, test setup only: it bypasses RLS to arrange fixtures) and, to act as a
 * real user, SUPABASE_PUBLISHABLE_KEY. Without them the suites skip. Same shape as venue-service's support/db.ts.
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

/** Throwaway events, venues, bookings and notifications (prefixed "IT-"), deleted afterwards. */
export class Fixtures {
  private venueIds: string[] = [];
  private eventIds: string[] = [];
  private notificationIds: string[] = [];

  constructor(readonly db: SupabaseClient) {}

  async venue(): Promise<string> {
    const { data, error } = await this.db
      .from("venues")
      .insert({ name: `IT-venue-${Math.random().toString(36).slice(2, 8)}`, address: "1 Test Road", max_capacity: 100 })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    this.venueIds.push(data.id as string);
    return data.id as string;
  }

  async event(organiserId: string, coordinatorId: string | null, status = "approved"): Promise<string> {
    const { data, error } = await this.db
      .from("events")
      .insert({
        name: `IT-event-${Math.random().toString(36).slice(2, 8)}`,
        organiser_id: organiserId,
        assigned_coordinator_id: coordinatorId,
        status,
        is_draft: status === "draft",
        expected_attendance: 50,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    this.eventIds.push(data.id as string);
    return data.id as string;
  }

  async booking(eventId: string, requestedBy: string): Promise<string> {
    const { data, error } = await this.db
      .from("venue_bookings")
      .insert({
        event_id: eventId,
        venue_id: await this.venue(),
        requested_by: requestedBy,
        status: "requested",
        event_start_datetime: "2030-10-01T01:00:00Z",
        event_end_datetime: "2030-10-01T09:00:00Z",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  }

  async notification(userId: string, extra: Record<string, unknown> = {}): Promise<string> {
    const { data, error } = await this.db
      .from("notifications")
      .insert({ user_id: userId, type: "event_submitted", title: "IT-title", message: "IT-message", ...extra })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    this.notificationIds.push(data.id as string);
    return data.id as string;
  }

  async cleanup(): Promise<void> {
    if (this.notificationIds.length) await this.db.from("notifications").delete().in("id", this.notificationIds);
    if (this.eventIds.length) {
      await this.db.from("venue_bookings").update({ amends_booking_id: null }).in("event_id", this.eventIds);
      await this.db.from("venue_bookings").delete().in("event_id", this.eventIds);
      await this.db.from("events").delete().in("id", this.eventIds);
    }
    if (this.venueIds.length) await this.db.from("venues").delete().in("id", this.venueIds);
  }
}
