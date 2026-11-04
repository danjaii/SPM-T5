import type { SupabaseClient } from "@supabase/supabase-js";
import { bookingError, forbidden, notFound, validationFailed } from "../domain/errors";

/** SCRUM-97: saves a hold's expiry. */
export interface HoldExpiryWriter {
  set(bookingId: string, expiresAt: Date): Promise<{ id: string; holdExpiresAt: Date }>;
}

/**
 * Calls the set_hold_expiry database function as the caller (migration 87). The function is the only way to write the column and
 * allows Venue Staff only, so the database stays the authority; the service's checks just give the clear refusals first.
 */
export class SupabaseHoldExpiryWriter implements HoldExpiryWriter {
  constructor(private readonly db: SupabaseClient) {}

  async set(bookingId: string, expiresAt: Date): Promise<{ id: string; holdExpiresAt: Date }> {
    const { data, error } = await this.db.rpc("set_hold_expiry", { p_booking_id: bookingId, p_expires_at: expiresAt.toISOString() });
    if (error) throw translate(error);
    const row = data as { id: string; hold_expires_at: string };
    return { id: row.id, holdExpiresAt: new Date(row.hold_expires_at) };
  }
}

/** HE001 -> 422 on the field, HE002 -> NOT_PENDING, HE003 -> HOLD_EXPIRED, 42501 -> 403, P0002 -> 404; anything else stays an ordinary error (500). */
export function translate(error: { code?: string; message: string }): Error {
  switch (error.code) {
    case "HE001":
      return validationFailed({ expiresAt: error.message });
    case "HE002":
      return bookingError("NOT_PENDING");
    case "HE003":
      return bookingError("HOLD_EXPIRED");
    case "42501":
      return forbidden();
    case "P0002":
      return notFound("Venue booking request not found.");
    default:
      return new Error(`Saving the hold expiry failed: ${error.message}`, { cause: error });
  }
}
