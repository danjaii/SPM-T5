/** User-scoped projection of a submitted event request for coordinator review. */
export interface SubmittedEventRequest {
  id: string;
  organiser_name: string;
  name: string;
  purpose: string | null;
  preferred_start_datetime: string | null;
  preferred_end_datetime: string | null;
  expected_attendance: number | null;
  layout_preferences: string | null;
  accessibility_requirements: string | null;
  equipment_requirements_notes: string | null;
  submitted_at: string | null;
  status: "submitted";
}
