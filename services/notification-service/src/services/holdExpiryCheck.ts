/** SCRUM-108: how often the check runs. */
export const HOLD_CHECK_INTERVAL_MS = 60_000;

/** What the check needs from Supabase: an rpc call. Tests pass a fake. */
export interface HoldExpiryDb {
  rpc(fn: "notify_hold_expiries", args: { p_now: string }): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * SCRUM-108/AC2: one pass. The database function writes each "expires soon" and "expired" notification once (it sets a sent flag on
 * the hold, so a second pass at the same time writes nothing) and says how many it wrote. The time is given, so tests control it.
 */
export async function runHoldExpiryCheck(db: HoldExpiryDb, now: () => Date): Promise<number> {
  const { data, error } = await db.rpc("notify_hold_expiries", { p_now: now().toISOString() });
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : 0;
}

export interface HoldExpiryCheckOptions {
  db: HoldExpiryDb;
  now?: () => Date;
  intervalMs?: number;
  log?: (message: string, error?: unknown) => void;
}

/**
 * SCRUM-108/AC3: runs the check every minute until stopped. A failed pass is logged and the next one still runs; a pass that is
 * still going when the timer fires is not doubled up.
 */
export function startHoldExpiryCheck({ db, now = () => new Date(), intervalMs = HOLD_CHECK_INTERVAL_MS, log = console.error }: HoldExpiryCheckOptions) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runHoldExpiryCheck(db, now)
      .catch((error: unknown) => log("The hold expiry check failed", error instanceof Error ? error : new Error(String(error))))
      .finally(() => { running = false; });
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
