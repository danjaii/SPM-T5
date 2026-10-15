import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationTargetKind } from "@spm-t5/shared";

export interface Target {
  kind: NotificationTargetKind;
  id: string;
}

export const targetKey = (t: Target) => `${t.kind}:${t.id}`;

/**
 * What the caller may still see of the things notifications point at (AC5, AC7). Everything is read under the
 * caller's own row level security, so "can I see it" is answered by the database, not re-implemented here.
 */
export interface AccessReader {
  /** The caller's role, used to pick the right page for a booking. */
  roleOf(userId: string): Promise<string | undefined>;
  /** A display label for each target the caller can see, keyed by targetKey(); targets they cannot see are absent. */
  visibleLabels(targets: Target[]): Promise<Map<string, string>>;
}

interface BookingRow {
  id: string;
  venues: { name: string } | { name: string }[] | null;
  events: { name: string } | { name: string }[] | null;
}

const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export class SupabaseAccessReader implements AccessReader {
  constructor(private readonly db: SupabaseClient) {}

  async roleOf(userId: string): Promise<string | undefined> {
    const { data, error } = await this.db.from("users").select("role").eq("id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.role as string | undefined) ?? undefined;
  }

  async visibleLabels(targets: Target[]): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    const eventIds = [...new Set(targets.filter((t) => t.kind === "event").map((t) => t.id))];
    const bookingIds = [...new Set(targets.filter((t) => t.kind === "venue_booking").map((t) => t.id))];

    if (eventIds.length) {
      const { data, error } = await this.db.from("events").select("id, name").in("id", eventIds);
      if (error) throw new Error(error.message);
      for (const e of data ?? []) labels.set(targetKey({ kind: "event", id: e.id as string }), e.name as string);
    }

    if (bookingIds.length) {
      const { data, error } = await this.db
        .from("venue_bookings")
        .select("id, venues(name), events(name)")
        .in("id", bookingIds);
      if (error) throw new Error(error.message);
      for (const b of (data ?? []) as unknown as BookingRow[]) {
        const venue = one(b.venues)?.name;
        const event = one(b.events)?.name;
        // The booking is visible even if its event is not (RLS on each table decides), so fall back gracefully.
        const label = venue && event ? `${venue} for ${event}` : (venue ?? event ?? "Venue booking");
        labels.set(targetKey({ kind: "venue_booking", id: b.id }), label);
      }
    }
    return labels;
  }
}
