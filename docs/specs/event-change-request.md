# Event Change Request: Final User Story

User story for **Submit an Event Change Request** (ConnectSphere, IS212), compiled 2026-10-06.

- Scenario numbers are the test IDs: `66-S4` means SCRUM-66, Scenario 4. Tests are named `SCRUM-66/ACn ...`.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-66 | [Event Change Request] Submit an Event Change Request | `event_change_requests` from `01_schema.sql`; events RLS from `14_events_rls.sql` (SCRUM-91) |

Approving or rejecting a change request, and applying it to the event, is a later story. This story only records the
request.

## Implementation decisions (2026-10-06)

These override the text below where they conflict.

- **Storage.** A request is one row in `event_change_requests` (`proposed_changes` jsonb, `change_description`,
  `status`). No new table. Venue and equipment requirements live **only** inside `proposed_changes`, so this story does
  not depend on a venue-requirements column on `events`. **[DECIDED]**
- **Endpoints** (`event-service`, port 4002; all need a session, 401 otherwise) **[DECIDED]**:

  | Method + path | Who | Response |
  | --- | --- | --- |
  | `POST /events/:id/change-requests` | the event's organiser (other roles 403; someone else's event 404) | 201 the request + `message`; 409 `NOT_ALLOWED`; 422 `NO_CHANGES` or `VALIDATION_FAILED` with `fieldErrors` |
  | `GET /events/:id/change-requests` | organiser (own events) or event coordinator | 200 requests, newest first, each with `status` |

  `GET /events/:id` also returns `isOrganiser` and `canRequestChange` so the page knows whether to show the form.
- **Which statuses.** A request is allowed in every status except `draft`, `cancelled`, `rejected` and `completed`
  (`canRequestChange` in `packages/shared`, mirrored by the INSERT policy in `15_event_change_requests_insert.sql`).
  `returned` is allowed. **[DECIDED]**
- **The event is not touched.** Organisers have no UPDATE on `events` (migration 11), and the route only inserts a
  request, so the event's details stay as they are until a request is approved. **[DECIDED]**
- **Append-only.** UPDATE and DELETE on `event_change_requests` are revoked from signed-in users, and the INSERT policy
  requires `status = 'pending'` and no reviewer fields, so an organiser cannot edit, withdraw or self-approve a request.
  **[DECIDED]**
- **Fields.** Omitted fields are unchanged. `proposed_changes` holds only the fields that differ from the event, each as
  `{ from, to }`: `expected_attendance`, `preferred_start_datetime`, `preferred_end_datetime`, `venue_requirements`,
  `equipment_requirements_notes`. **[DECIDED]**
- **Attendance** must be a positive whole number (at least 1), stricter than the database check (`>= 0`). **[DECIDED]**
- **Date and times** are Singapore time, stored as UTC (same helpers as venue booking). The date is checked against the
  injected clock only when the start (date or start time) is being changed. The form shows the End date: for a
  single-day event it follows the date, and a multi-day event keeps its own end date until the organiser edits it.
  **[DECIDED]**
- **Description.** `change_description` is required by the database. It is the organiser's optional reason, or an
  automatic summary such as "Changed: expected attendance, start time". **[DECIDED]**
- **Validation is shared.** `parseEventChangeRequestInput` in `packages/shared` runs in the form and the service, so
  they agree. Text fields are trimmed and limited to 2000 characters. **[DECIDED]**

---

## SCRUM-66 Submit an Event Change Request

**User story.** As an Event Organiser, I want to request changes to my event after it has been submitted, so that the
event can be updated to reflect its current requirements.

### Acceptance criteria

*AC1.* Given that my event has been submitted, when I open it, I can create a change request.

*AC2.* Given that my event is cancelled, rejected or completed, I cannot create a change request.

*AC3.* Given that my event is a draft, I cannot create a change request.

*AC4.* Given that I have not changed any detail, the system does not submit the request and tells me no changes were made.

*AC5.* Given that the expected attendance is not a positive whole number, it is not allowed.

*AC6.* Given a valid request, the system tells me the submission succeeded, and the event's current details stay
unchanged until the request is approved.

*AC7.* Given that I have submitted a request, when I view my event, I see whether the request is pending, approved or
rejected.

*AC8.* I can edit the expected attendance, date, start time, end time, venue requirements and equipment requirements.

*AC9.* Editing the date to a past date is not allowed.

*AC10.* An end time before the start time is not allowed. The end is the End date plus End time, so a multi-day event
may end earlier in the day than it starts (e.g. 17 Feb 09:00 to 18 Feb 08:00); the End date is shown so this is visible.
An End date before the date is refused on the End date field.

### Scenarios

| ID | AC | Scenario | Expected |
| --- | --- | --- | --- |
| 66-S1 | AC1 | The organiser opens their own submitted (or later, not terminal) event | The change request form is shown; a valid POST stores a pending request (201) |
| 66-S2 | AC2 | The event is cancelled, rejected or completed | No form; POST is 409 `NOT_ALLOWED`; the database also refuses |
| 66-S3 | AC3 | The event is a draft | No form; POST is 409 `NOT_ALLOWED`; the database also refuses |
| 66-S4 | AC4 | Every submitted value equals the event's current value | Nothing is stored; 422 `NO_CHANGES` "No changes were made" |
| 66-S5 | AC5 | Attendance is 0, negative, fractional or not a number | Field error; nothing stored |
| 66-S6 | AC6 | A valid request | 201 and a success message; the event row is unchanged; the request is `pending` |
| 66-S7 | AC7 | The organiser views the event | Each request is listed with Pending, Approved or Rejected |
| 66-S8 | AC8 | The organiser edits any of the six fields | Only the fields that differ are stored in `proposed_changes` |
| 66-S9 | AC9 | The new date is before today, or the start is earlier today | Field error on date or start time; nothing stored |
| 66-S10 | AC10 | End time is before or equal to the start time | Field error on end time; nothing stored |
| 66-S11 | AC10 | End date is before the date | Field error on end date; nothing stored |
| 66-S12 | AC10 | Multi-day event, End date after the date, End time earlier on the clock than Start time | Accepted; the end is still after the start |

Other people: a coordinator or attendee gets 403 on POST; another organiser's event is 404; the database refuses an
insert for anyone but the event's organiser, in their own name, as a pending request.
