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
