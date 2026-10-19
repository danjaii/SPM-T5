import type { AffectedArrangement, ChangeRequestRow } from "@spm-t5/shared";
import { EVENT_URL, type ApiResult } from "./api";

// Browser-safe types and calls for SCRUM-67 (docs/specs/review-change-request.md). The server-side fetch lives in
// ./changeRequestReviewServer.

/** GET /change-requests/:id: the request read against the event, and what the coordinator can do. */
export interface ChangeRequestReviewView {
  id: string;
  eventId: string;
  eventName: string;
  status: "pending" | "approved" | "rejected";
  changeDescription: string;
  requestedAt: string;
  reviewedAt: string | null;
  reviewNotes: string | null;
  rows: ChangeRequestRow[];
  outdated: boolean;
  unsupported: string[];
  canApprove: boolean;
  canReject: boolean;
  /** SCRUM-112: what approving sends back for review. */
  affected: AffectedArrangement[];
}

type Result = ApiResult<{ status?: string; message?: string; code?: string; fieldErrors?: Record<string, string> }>;

async function decide(id: string, action: "approve" | "reject", body?: object): Promise<Result> {
  try {
    const res = await fetch(`${EVENT_URL}/change-requests/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } };
  }
}

/** AC3: approve; event-service applies it and sends the affected arrangements back for review. */
export const approveChangeRequest = (id: string) => decide(id, "approve");

/** AC4, AC5: reject with a reason; the event is not touched. */
export const rejectChangeRequest = (id: string, reason: string) => decide(id, "reject", { reason });
