import { fireEvent, screen } from "@testing-library/react";

export const LAYOUT = "a685c8bf-c57d-5cb4-be30-49dedce9a02b";
export const layouts = [{ id: LAYOUT, name: "Theatre" }];
export const future = (days: number, hour: number) => {
  const d = new Date(Date.now() + days * 86_400_000 + 8 * 3_600_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

// An event row as GET /events/drafts/:id sends it (columns beyond the form's are ignored)
export const stored = {
  id: "draft-1", status: "draft", organiser_id: "u1", updated_at: "2026-10-29T06:00:00Z",
  name: "Tech Summit", purpose: "Showcase", description: "A day of demos",
  preferred_start_datetime: future(60, 1), preferred_end_datetime: future(60, 9), expected_attendance: 250,
  venue_requirements: "Near an MRT", preferred_room_layout_id: LAYOUT,
  accessibility_requirements: "Hearing loop, Quiet room, Seat near the exit", equipment_requirements_notes: "Two mics",
  registration_required: true, registration_capacity: 100,
  registration_opens_at: future(30, 1), registration_closes_at: future(59, 1),
};

export const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
export const click = (name: RegExp | string) => fireEvent.click(screen.getByRole("button", { name }));
/** Continue through the five steps before Review (the stepper does not skip ahead). */
export const toReview = () => { for (let i = 0; i < 5; i++) click(/^Continue to/); };
