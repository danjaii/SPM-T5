/** SCRUM-133/AC2: a hold turns to a warning tone when it expires within this long. */
export const HOLD_WARNING_MS = 24 * 60 * 60 * 1000;

export type HoldState = "active" | "expiring" | "expired";

export interface HoldCountdown {
  state: HoldState;
  /** "in 6 hours", "in 40 minutes", or "expired". */
  remaining: string;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/**
 * SCRUM-133/AC2, AC3: where a hold stands at `now`. Active until 24 hours before it lapses, then expiring (warning tone),
 * then expired, which is never shown as a booking. The venue-service has no holds yet, so `expiresAt` comes from whatever
 * later supplies `holdExpiresAt` on a booking.
 */
export function holdCountdown(expiresAt: string, now: Date): HoldCountdown {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (Number.isNaN(ms) || ms <= 0) return { state: "expired", remaining: "expired" };
  const minutes = Math.ceil(ms / 60_000);
  const remaining =
    minutes < 60 ? `in ${plural(minutes, "minute")}` : minutes < 48 * 60 ? `in ${plural(Math.round(minutes / 60), "hour")}` : `in ${plural(Math.round(minutes / (24 * 60)), "day")}`;
  return { state: ms <= HOLD_WARNING_MS ? "expiring" : "active", remaining };
}
