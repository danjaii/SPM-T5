import type { TechnicalAssignmentBody, TechnicalAssignmentStatus } from "@spm-t5/shared";
import { EQUIPMENT_URL, type ApiResult } from "./api";

// Browser-safe types and calls for SCRUM-20's on-site assignments (docs/specs/technical-assignment-notifications.md).
// The server-side fetch lives in ./technicalAssignmentsServer.

/** One assignment as equipment-service returns it. Dates and times are Singapore time. */
export interface TechnicalAssignmentView {
  id: string;
  staffId: string;
  staffName: string | null;
  venueBookingId: string | null;
  venueName: string | null;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  note: string | null;
  status: TechnicalAssignmentStatus;
  statusLabel: string;
  acknowledgedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

/** One of the event's approved venue bookings an assignment can be for. */
export interface AssignmentVenueOption {
  id: string;
  venueName: string;
  date: string;
  startTime: string;
  endTime: string;
}

/** GET /events/:id/technical-assignments: the event's assignments and what the assign form offers. */
export interface EventTechnicalAssignmentsView {
  assignments: TechnicalAssignmentView[];
  canAssign: boolean;
  staff: { id: string; name: string }[];
  venues: AssignmentVenueOption[];
}

type Result = ApiResult<TechnicalAssignmentView & { code?: string; fieldErrors?: Record<string, string> }>;

async function send(path: string, method: string, body: unknown): Promise<Result> {
  try {
    const res = await fetch(`${EQUIPMENT_URL}${path}`, {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  } catch {
    return { ok: false, data: { error: "We couldn't reach the server. Please try again." } as Result["data"] };
  }
}

/** AC1: assign a technician; equipment-service and the database check everything again. */
export const assignTechnicalStaff = (eventId: string, body: TechnicalAssignmentBody) =>
  send(`/events/${encodeURIComponent(eventId)}/technical-assignments`, "POST", body);

/** AC2: change the venue booking, times or note. */
export const changeTechnicalAssignment = (id: string, body: TechnicalAssignmentBody) =>
  send(`/technical-assignments/${encodeURIComponent(id)}`, "PATCH", body);

/** AC3: cancel, with the reason the technician is told. */
export const cancelTechnicalAssignment = (id: string, reason: string) =>
  send(`/technical-assignments/${encodeURIComponent(id)}/cancel`, "POST", { reason });
