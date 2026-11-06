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
