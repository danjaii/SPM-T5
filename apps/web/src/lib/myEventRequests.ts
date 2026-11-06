import { EVENT_STATUSES } from "@spm-t5/shared";
/** SCRUM-52/AC1: one row of the organiser's My event requests list, as GET /events/my-requests sends it. */
export interface MyEventRequest {
  id: string;
  name: string;
  status: string;
  preferred_start_datetime: string | null;
  expected_attendance: number | null;
  submitted_at: string | null;
  /** SCRUM-53/AC3: when the request was last saved; shown for a draft. */
  updated_at?: string | null;
}

/** SCRUM-55/AC2: the placeholder a draft saved without a name carries. */
export const UNTITLED_DRAFT = "Untitled draft";

/** SCRUM-55/AC2: a draft with a blank or placeholder name has no real name to show. */
export const isUntitledDraft = (request: MyEventRequest) =>
  request.status === "draft" && (request.name.trim() === "" || request.name.trim() === UNTITLED_DRAFT);

export const isDraft = (request: MyEventRequest) => request.status === "draft";

export interface StatusFilterOption {
  status: string;
  count: number;
}

/** SCRUM-55/AC3: the statuses present in the list with their counts, in lifecycle order; a status the app does not know goes last. */
export function statusFilterOptions(requests: MyEventRequest[]): StatusFilterOption[] {
  const counts = new Map<string, number>();
  for (const { status } of requests) counts.set(status, (counts.get(status) ?? 0) + 1);
  const rank = (status: string) => {
    const i = (EVENT_STATUSES as readonly string[]).indexOf(status);
    return i === -1 ? EVENT_STATUSES.length : i;
  };
  return [...counts.entries()].sort(([a], [b]) => rank(a) - rank(b)).map(([status, count]) => ({ status, count }));
}
