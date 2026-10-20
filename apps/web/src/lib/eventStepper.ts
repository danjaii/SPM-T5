import { EVENT_STATUS_DISPLAY, type StatusDisplay } from "@/lib/status";

// SCRUM-127/AC1: the eight stages of the event stepper (Figma "Status stepper"). Assigned and Safety check are not statuses of
// their own: Assigned is a submitted event that has a coordinator, and Safety check is awaiting_arrangements.
export const STEPPER_STAGES = ["Draft", "Submitted", "Assigned", "Under review", "Planning", "Safety check", "Confirmed", "Completed"] as const;

const DRAFT = 0, SUBMITTED = 1, ASSIGNED = 2, UNDER_REVIEW = 3, PLANNING = 4, SAFETY_CHECK = 5, CONFIRMED = 6, COMPLETED = 7;

export type StepState = "done" | "current" | "upcoming" | "stopped";

export interface Step {
  label: (typeof STEPPER_STAGES)[number];
  state: StepState;
  /** SCRUM-127/AC2: set on the step where the event was returned, rejected or cancelled. */
  badge?: StatusDisplay;
}

const CHANGES_REQUESTED: StatusDisplay = { tone: "warning", icon: "alert", label: "Changes requested" };

/** The stage a status sits on. approved has no stage of its own: review is finished and planning has not started. */
function stageOf(status: string, hasCoordinator: boolean): number | undefined {
  switch (status) {
    case "draft": return DRAFT;
    case "submitted": return hasCoordinator ? ASSIGNED : SUBMITTED;
    case "under_review": case "returned": case "approved": return UNDER_REVIEW;
    case "planning": return PLANNING;
    case "awaiting_arrangements": return SAFETY_CHECK;
    case "confirmed": return CONFIRMED;
    case "completed": return COMPLETED;
    default: return undefined;
  }
}

/**
 * Builds the stepper for an event. A rejected or cancelled event stops at the stage it had before (`previousStatus`); without that
 * history a rejection was in review, and a cancellation is placed on Submitted, the first stage every real request reaches.
 */
export function buildSteps(status: string, hasCoordinator: boolean, previousStatus?: string | null): Step[] {
  const stoppedBy = status === "rejected" || status === "cancelled" ? status : undefined;
  const fallback = status === "rejected" ? UNDER_REVIEW : SUBMITTED;
  const at = stoppedBy ? ((previousStatus ? stageOf(previousStatus, hasCoordinator) : undefined) ?? fallback) : stageOf(status, hasCoordinator);
  const current = stoppedBy || status === "approved" ? undefined : at;
  const doneThrough = status === "approved" ? UNDER_REVIEW : (at ?? 0) - 1;

  return STEPPER_STAGES.map((label, i): Step => {
    if (stoppedBy && i === at) return { label, state: "stopped", badge: EVENT_STATUS_DISPLAY[stoppedBy] };
    if (i <= doneThrough) return { label, state: "done" };
    if (i === current) return { label, state: "current", badge: status === "returned" ? CHANGES_REQUESTED : undefined };
    return { label, state: "upcoming" };
  });
}
