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
 * SCRUM-108/AC4: `warningMs` is the hold's own warning window (the coordinator sets it per hold); without one it is 24 hours.
 */
export function holdCountdown(expiresAt: string, now: Date, warningMs: number = HOLD_WARNING_MS): HoldCountdown {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (Number.isNaN(ms) || ms <= 0) return { state: "expired", remaining: "expired" };
  const minutes = Math.ceil(ms / 60_000);
  const remaining =
    minutes < 60 ? `in ${plural(minutes, "minute")}` : minutes < 48 * 60 ? `in ${plural(Math.round(minutes / 60), "hour")}` : `in ${plural(Math.round(minutes / (24 * 60)), "day")}`;
  return { state: ms <= warningMs ? "expiring" : "active", remaining };
}

export interface HoldNotice {
  kind: "warning" | "expired";
  text: string;
}

/**
 * SCRUM-108/AC2, AC3, AC5: the one line a coordinator's list and detail page show about a hold. "Hold expires in 8 hours" only
 * inside the hold's own warning window (24 hours when it has none); "Hold expired, venue no longer reserved" once it lapsed
 * (venue-service sends the derived status EXPIRED, SCRUM-97/AC4); nothing for a confirmed booking (AC6) or one with no expiry.
 */
export function holdNotice(
  b: { status?: string; holdExpiresAt?: string | null; holdWarningMinutes?: number },
  now: Date,
): HoldNotice | undefined {
  if (b.status === "EXPIRED") return { kind: "expired", text: "Hold expired, venue no longer reserved" };
  if (b.status !== "PENDING" || !b.holdExpiresAt) return undefined;
  const hold = holdCountdown(b.holdExpiresAt, now, b.holdWarningMinutes ? b.holdWarningMinutes * 60_000 : undefined);
  if (hold.state === "expired") return { kind: "expired", text: "Hold expired, venue no longer reserved" };
  return hold.state === "expiring" ? { kind: "warning", text: `Hold expires ${hold.remaining}` } : undefined;
}
