/**
 * SCRUM-97/AC1: the expiry Venue Staff give a tentative hold. It must be a real date and time, in the future, and not after the
 * event starts (a hold that outlives its event means nothing). The same rule runs in the database (set_hold_expiry, HE001).
 * `now` is passed in so tests and the service decide what the time is.
 */
export type HoldExpiryParse = { ok: true; data: { expiresAt: Date } } | { ok: false; fieldErrors: { expiresAt: string } };

const REQUIRED = "An expiry date and time in the future is required.";

export function parseHoldExpiryInput(body: unknown, now: Date, eventStart: Date): HoldExpiryParse {
  const raw = body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).expiresAt : undefined;
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return refuse(REQUIRED);
  if (typeof raw !== "string") return refuse("The expiry must be a date and time.");
  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) return refuse("The expiry must be a date and time.");
  if (expiresAt.getTime() <= now.getTime()) return refuse(REQUIRED);
  if (expiresAt.getTime() > eventStart.getTime()) return refuse("The expiry must be before the event starts.");
  return { ok: true, data: { expiresAt } };
}

const refuse = (message: string): HoldExpiryParse => ({ ok: false, fieldErrors: { expiresAt: message } });

/** SCRUM-108/AC1: how long before a hold expires the coordinator is warned, unless they choose otherwise (24 hours, a team assumption). */
export const HOLD_WARNING_DEFAULT_MINUTES = 1440;
/** The longest warning time: 30 days. The database repeats the limit (set_hold_warning, HW001). */
export const HOLD_WARNING_MAX_MINUTES = 43200;

export type HoldWarningParse = { ok: true; data: { minutes: number } } | { ok: false; fieldErrors: { minutes: string } };

/** SCRUM-108/AC1: the warning time the event's coordinator gives one hold, in whole minutes before it expires. */
export function parseHoldWarningInput(body: unknown): HoldWarningParse {
  const raw = body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).minutes : undefined;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > HOLD_WARNING_MAX_MINUTES) {
    return { ok: false, fieldErrors: { minutes: "A warning time from 1 minute to 30 days is required." } };
  }
  return { ok: true, data: { minutes: raw } };
}
