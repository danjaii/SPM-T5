import type { SupabaseClient } from "@supabase/supabase-js";
import { bookingError, forbidden, notFound, validationFailed } from "../domain/errors";

/** SCRUM-108/AC1: saves a hold's warning time. */
export interface HoldWarningWriter {
  setWarning(bookingId: string, minutes: number): Promise<{ id: string; holdWarningMinutes: number }>;
}

/**
 * Calls the set_hold_warning database function as the caller (migration 88). The function allows only the event's assigned
 * coordinator, so the database stays the authority; the service's checks give the clear refusals first.
 */
export class SupabaseHoldWarningWriter implements HoldWarningWriter {
  constructor(private readonly db: Pick<SupabaseClient, "rpc">) {}

  async setWarning(bookingId: string, minutes: number): Promise<{ id: string; holdWarningMinutes: number }> {
    const { data, error } = await this.db.rpc("set_hold_warning", { p_booking_id: bookingId, p_minutes: minutes });
    if (error) throw translateWarningError(error);
    const row = data as { id: string; hold_warning_minutes: number };
    return { id: row.id, holdWarningMinutes: row.hold_warning_minutes };
  }
}

/** HW001 -> 422 on the field, HW002 -> NOT_PENDING, 42501 -> 403, P0002 -> 404 (also for someone else's event); anything else stays an ordinary error (500). */
export function translateWarningError(error: { code?: string; message: string }): Error {
  switch (error.code) {
    case "HW001":
      return validationFailed({ minutes: error.message });
    case "HW002":
      return bookingError("NOT_PENDING");
    case "42501":
      return forbidden();
    case "P0002":
      return notFound("Venue booking request not found.");
    default:
      return new Error(`Saving the hold warning time failed: ${error.message}`, { cause: error });
  }
}
