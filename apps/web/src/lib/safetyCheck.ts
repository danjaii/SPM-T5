import type { SafetyDecision } from "@spm-t5/shared";
import { EVENT_URL, type ApiResult } from "./api";

/** SCRUM-99/AC8: a saved safety decision, as event-service returns it. */
export interface RecordedSafetyDecision {
  decision: SafetyDecision;
  reason: string | null;
  officer_name: string;
  decided_at: string;
  /** AC5: how the decision reads, e.g. "Safety Approved". */
  label: string;
}

/** SCRUM-99/AC4-AC6: record the Safety Officer's decision on an event, from the browser. */
export async function recordSafetyDecision(
  eventId: string,
  decision: SafetyDecision,
  reason: string,
): Promise<ApiResult<RecordedSafetyDecision>> {
  try {
    const res = await fetch(`${EVENT_URL}/safety-checks/${encodeURIComponent(eventId)}/decision`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason }),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as never };
  }
}
