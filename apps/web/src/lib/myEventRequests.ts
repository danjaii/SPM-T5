/** SCRUM-52/AC1: one row of the organiser's My event requests list, as GET /events/my-requests sends it. */
export interface MyEventRequest {
  id: string;
  name: string;
  status: string;
  preferred_start_datetime: string | null;
  expected_attendance: number | null;
  submitted_at: string | null;
}

/** SCRUM-55/AC2: the placeholder a draft saved without a name carries. */
export const UNTITLED_DRAFT = "Untitled draft";

/** SCRUM-55/AC2: a draft with a blank or placeholder name has no real name to show. */
export const isUntitledDraft = (request: MyEventRequest) =>
  request.status === "draft" && (request.name.trim() === "" || request.name.trim() === UNTITLED_DRAFT);

export const isDraft = (request: MyEventRequest) => request.status === "draft";
