# SCRUM-54 — Resume Editing a Draft Event Request

**Jira:** SCRUM-54 (Draft Event Requests)
**Branch:** `SCRUM-54/resume-draft-event-request` (stacked on `SCRUM-53/save-draft-event-request`)

## Story

As an `event_organiser`, I want to reopen and continue editing a saved draft event request so that I can finish providing
the required details before submitting it.

Backend only. The drafts list, the form pre-filled from a draft and the Save/Submit buttons are SCRUM-124 (another
developer), which consumes the contract at the bottom. Not built here: deleting a draft (SCRUM-56), SCRUM-55, SCRUM-51,
SCRUM-130, and copying a past request into a new draft (Week 9 clarification).

## Acceptance criteria

### AC1 — Open existing draft
- **Given** I have one or more saved drafts
- **When** I select a draft from my list of event requests
- **Then** the form opens pre-filled with the previously saved information

Scenarios:
- `GET /events/drafts/:id` as the owner answers 200 with the stored fields under their stored names (ids included:
  `preferred_room_layout_id`, the registration fields, `venue_requirements`...), `status: "draft"` and `updated_at`.
- A draft with empty fields returns them as `null`; an unnamed draft returns `name: "Untitled draft"`.
- An id that is not a uuid, does not exist or belongs to someone else: 404. A coordinator or attendee: 403. No session: 401.

### AC2 — Continue and re-save
- **Given** I have made further edits to a draft
- **When** I save again
- **Then** the draft is updated with the new information and the last-saved timestamp is refreshed

Scenarios:
- `PUT /events/drafts/:id` validates with the same lenient `parseEventRequestDraft` as SCRUM-53 (same 422 shape), stores
  the whole body and answers 200 with the row. `updated_at` is later than before (trigger `trg_events_updated_at`).
- PUT replaces the draft: a field left out or sent empty is cleared (null). That is how an organiser blanks a field.
- Status, organiser, organisation, coordinator and timestamps cannot be changed through it, whatever the body says.
- A 422 changes nothing.

### AC3 — Submit from draft
- **Given** a draft now has all mandatory fields completed
- **When** I choose to submit it
- **Then** the request status changes from Draft to Submitted

Scenarios:
- `POST /events/drafts/:id/submit` validates with the strict `parseEventRequest`, exactly as `POST /events` does. An
  incomplete or invalid draft answers 422 `VALIDATION_FAILED` with `fieldErrors` for every bad field, and the draft stays a
  draft and unchanged.
- On success: `status: "submitted"`, `is_draft: false`, `submitted_at` set, one `event_status_history` row
  (`draft` -> `submitted`, changed by the organiser), no coordinator, so it lands in the Event Coordinator Lead's unassigned
  queue (`lead_unassigned_queue()`, migration 21). Answers 200 with the row.
- Body optional. With no body the saved draft is submitted. With a body it is the same fields as PUT ("save and submit"):
  they are validated strictly, saved, then submitted. If the body is invalid nothing is saved.
- As for `POST /events`, registration capacity and window are cleared when `registration_required` is false.
- Submitting writes no notification (`notify_event_decision` only reacts to approved/rejected).

### AC4 — Prevent editing after submission
- **Given** a request has already been submitted (no longer a draft)
- **When** I attempt to edit it through the draft-editing flow
- **Then** the draft-editing flow is not available for that request

Scenarios:
- GET, PUT and submit on a request that is not a draft answer 409 `{ code: "NOT_A_DRAFT" }`, for the owner. Nothing changes.
- The database agrees: the organiser UPDATE policy only matches `status = 'draft'` rows, so a direct update of a submitted
  request changes nothing; the organiser can never set a request back to draft or move it on by a plain update.
- Another organiser, a coordinator or an attendee cannot read, update or submit someone else's draft (404, or 403 by role).
- Week 9 customer clarification ("organisers cannot directly edit or alter submitted requests on their own") matches.

## Decisions
- Last-saved time is `events.updated_at`; an unnamed draft is "Untitled draft" (team decisions, SCRUM-53).
- **Re-save = `update_event_draft()` (security invoker) + organiser UPDATE policy + column guard trigger.** The policy
  (`events_update_organiser_draft`) matches only the caller's own drafts and its `WITH CHECK` pins organiser, status
  `draft`, `is_draft`, no `submitted_at`, no coordinator, no confirmed/cancelled/completed time. A policy cannot restrict
  columns, so trigger `trg_events_organiser_draft_guard` refuses an organiser changing `client_organisation_id`,
  `event_category_id`, `cloned_from_event_id`, `created_at` (and the columns above) for every caller path, including a direct
  PATCH. The function only names the 14 draft fields.
- **Submit = `submit_event_draft()` (security definer).** A plain update cannot submit: the policy pins `status = 'draft'`,
  so only this function can move a draft on. It checks the caller itself (organiser role, own row, still a draft), locks the
  row, refuses a draft missing a mandatory field (a last check in the database; the real rules are `parseEventRequest`,
  run by the service first), sets submitted state, clears registration details when not required and writes the history row.
  Because it writes the history row itself, no organiser INSERT policy for `draft -> submitted` history is added: that policy
  would let an organiser forge history rows by direct insert, for no gain.
- `events_status_change_guard()` (migration 14) refuses an organiser changing status, as the organiser is not the assigned
  coordinator. Migration 53 replaces it (same name) to also allow the owner's `draft -> submitted`, nothing else.
- Custom SQLSTATEs (class `DR`): `DR001` not your draft/not found, `DR002` not a draft, `DR003` incomplete.
- PUT replaces all draft fields (cleared = null), matching the form that sends everything it shows.

## AC → test mapping

| AC | Test file | `describe` / `it` |
| ----- | ----- | ----- |
| AC1 | `services/event-service/tests/unit/event-draft-resume.test.ts` | `SCRUM-54/AC1 open a draft (GET /events/drafts/:id)` |
| AC1 | `services/event-service/tests/integration/eventDraftResumeDb.test.ts` | `SCRUM-54/AC1 ...` |
| AC2 | `services/event-service/tests/unit/event-draft-resume.test.ts` | `SCRUM-54/AC2 re-save a draft (PUT /events/drafts/:id)` |
| AC2 | `services/event-service/tests/integration/eventDraftResumeDb.test.ts` | `SCRUM-54/AC2 ...` |
| AC3 | `services/event-service/tests/unit/event-draft-resume.test.ts` | `SCRUM-54/AC3 submit a draft (POST /events/drafts/:id/submit)` |
| AC3 | `packages/shared/tests/unit/eventDraft.test.ts` | `SCRUM-54/AC3 draftToEventRequestInput ...` (if a mapper is shared) |
| AC3 | `services/event-service/tests/integration/eventDraftResumeDb.test.ts` | `SCRUM-54/AC3 ...` |
| AC4 | `services/event-service/tests/unit/event-draft-resume.test.ts` | `SCRUM-54/AC4 ...` |
| AC4 | `services/event-service/tests/integration/eventDraftResumeDb.test.ts` | `SCRUM-54/AC4 ...` |

## Affected workspaces
- `supabase/migrations/53_resume_draft_event_request.sql` (new): organiser UPDATE policy, column guard trigger,
  `update_event_draft()`, `submit_event_draft()`, replaced `events_status_change_guard()`. Affects event-service; the guard is
  shared by every path that changes `events.status`, so other services' status changes are covered by running their tests.
- `services/event-service`: `routes/eventDrafts.ts` (extended), no new mount.
- `packages/shared`: not changed unless noted in the commit log.
- `services/event-service/tests/integration/eventDraftCreateRls.test.ts` (SCRUM-53): one test asserted the owner could not
  update a draft yet and named SCRUM-54 as the change; it is edited minimally (see the commit).
- No `apps/web` change: the UI is SCRUM-124. No C4/ADR change.

## Out of scope
- Any UI; delete a draft (SCRUM-56); copy a past request as a new draft; attachments (SCRUM-51).

## Open questions
- None blocking. "Save and submit" in one call is an addition for SCRUM-124's convenience; the plain submit still works.

## Contract for SCRUM-124

All routes: cookie `cs_session` (`credentials: "include"`), base `http://localhost:4002`. 401 `{ error: "Not signed in." }`,
403 `{ error: "You are not allowed to create event requests." }` for other roles, 404 `{ error: "Draft not found." }` when
the id is not the caller's draft (or not a uuid), 409 `{ code: "NOT_A_DRAFT", error: "This request has been submitted, so it can no longer be edited as a draft." }` when it is the caller's but submitted.

`POST /events/drafts` (SCRUM-53, unchanged) creates a draft and returns the row.

- `GET /events/drafts/:id` -> 200 the stored row: `id, name, purpose, description, preferred_start_datetime,
  preferred_end_datetime, expected_attendance, venue_requirements, preferred_room_layout_id, accessibility_requirements,
  equipment_requirements_notes, registration_required, registration_capacity, registration_opens_at, registration_closes_at,
  status, is_draft, submitted_at, created_at, updated_at` (`updated_at` = last saved). Empty fields are `null`.
- `PUT /events/drafts/:id` body: the same fields as `POST /events/drafts`, all optional; sent as the whole form. A field
  left out or empty is cleared. -> 200 the row (same fields as GET, `updated_at` refreshed). 422
  `{ code: "VALIDATION_FAILED", error: "Check the highlighted fields.", fieldErrors }`. 500 `{ error: "Could not save the draft." }`.
- `POST /events/drafts/:id/submit` body optional; empty or none submits the saved draft, otherwise the body is the form
  (same fields as PUT), saved then submitted. -> 200 the row with `status: "submitted"`, `is_draft: false`, `submitted_at`.
  422 `{ code: "VALIDATION_FAILED", error: "Check the highlighted fields.", fieldErrors }` listing every missing or invalid
  field (strict rules of `POST /events`); the draft is left as it was. 500 `{ error: "Could not submit the request." }`.
- After submitting, the request is a normal submitted request: open it with `GET /events/:id`; the draft routes now answer 409.
