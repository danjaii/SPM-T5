# SCRUM-53 — Save an Event Request as a Draft

**Jira:** SCRUM-53 (Draft Event Requests)
**Branch:** `SCRUM-53/save-draft-event-request`

## Story

As an `event_organiser`, I want to save an incomplete event request as a draft so that I do not lose my progress and can
complete it later without submitting it prematurely.

Backend only. The Save draft button and the drafts list are SCRUM-124 (another developer). Resuming, re-saving, submitting
from a draft and deleting a draft are SCRUM-54 and SCRUM-56. Copying a past request into a new draft (Week 9 clarification)
is a separate story. None of those are built here.

## Acceptance criteria

### AC1 — Save incomplete request
- **Given** I am filling in a new event request and have not completed all mandatory fields
- **When** I choose to save as draft
- **Then** the request is stored with a status of Draft

Scenarios:
- An organiser sends only some fields; `POST /events/drafts` answers 201 with the stored row: `status: "draft"`, `is_draft: true`,
  `submitted_at: null`, the sent fields kept, the others `null`.
- The organiser and the client organisation come from the caller's token and users row, never from the body. A body that names
  another `organiser_id`, `status`, `assigned_coordinator_id` or `submitted_at` has no effect (those keys are dropped).
- No `event_status_history` row is written. History starts at submission (`create_event_request`, migration 49, writes
  `null -> submitted`). A draft is not yet a status change anyone reviews; adding a row for it would also need a second
  history insert policy. SCRUM-54 can record the `draft -> submitted` change at submission.
- The draft shows in `GET /events/my-requests` (SCRUM-52) with status `draft`, with no change to that route.
- A failed write answers 500 `{ error: "Could not save the draft." }`, never a fake success.

### AC2 — No validation blocking
- **Given** I am saving a request as a draft
- **When** I trigger the save
- **Then** incomplete or empty mandatory fields do not prevent the save (unlike submission)

Exactly what is and is not enforced for a draft (`parseEventRequestDraft` in `packages/shared/src/eventDraft.ts`):

| Rule | Draft |
| ----- | ----- |
| Any field missing, `null`, `""` or whitespace only | Accepted, stored as `null` (the name becomes "Untitled draft") |
| Empty body `{}` | Accepted: an all-"Untitled draft" row |
| Body not an object (array, string, number) | 422, `fieldErrors.body` |
| A text field that is not a string (number, object...) | 422 on that field |
| `expected_attendance`, `registration_capacity` given but not a whole number, or negative | 422 (the table has `>= 0`; 0 is allowed for a draft) |
| `preferred_start_datetime`, `preferred_end_datetime`, `registration_opens_at`, `registration_closes_at` given but not a parseable date | 422 |
| `preferred_room_layout_id` given but not a uuid | 422 |
| `registration_required` given but not a boolean | 422; missing means `false` |
| Both start and end given and end not after start | 422 on `preferred_end_datetime` (table check) |
| Both registration opens and closes given and closes not after opens | 422 on `registration_closes_at` (table check) |
| Start in the future; registration closing by event start; registration fields required when registration is needed; non-empty purpose, description, venue and equipment text | Not enforced (submission rules, `parseEventRequest`) |
| Unknown keys | Dropped |

Registration capacity, opening and closing are kept as typed even when `registration_required` is false, so toggling the
switch does not lose what the organiser entered; submission clears them (`parseEventRequest`). A valid room layout uuid that
does not exist is refused by the foreign key, which is a 500 here (the form offers only real layouts).

### AC3 — Record last-saved details
- **Given** a draft has been saved
- **Then** the system records the date and time it was last saved

Decision: the last-saved time is `events.updated_at` (set by `trg_events_updated_at`, `01_schema.sql`); no new column. The
response includes it. On creation it equals the save time. SCRUM-54's re-save will move it through the same trigger.

### AC4 — Authorisation
- **Given** I am not the Event Organiser who created the draft
- **When** I attempt to access it
- **Then** I cannot view or edit it

Scenarios:
- Another organiser, a coordinator (not assigned), and an attendee cannot read the draft (migration 14 select policies;
  `GET /events/:id` answers 404, `GET /events/my-requests` omits it) and cannot update or delete it.
- The owner cannot update or delete it directly either: there is no organiser UPDATE or DELETE policy yet. Intended; SCRUM-54 adds it.
- `POST /events/drafts` is organiser-only: 401 without a session, 403 for every other role. RLS refuses the insert too (42501).
- The insert policy refuses a draft row that names a different organiser, a status other than `draft`, `is_draft = false`, a
  `submitted_at`, an assigned coordinator, or any of the confirmed/cancelled/completed timestamps.

## Decisions (already made by the team)
- Last-saved time is `events.updated_at`.
- A draft with no name (missing, empty or whitespace) is stored as "Untitled draft" (`events.name` is NOT NULL). The database
  function does this, so every caller gets it.
- No history row for a draft (see AC1).

## AC → test mapping

| AC | Test file | `describe` / `it` |
| ----- | ----- | ----- |
| AC1 | `services/event-service/tests/unit/event-draft-create.test.ts` | `SCRUM-53/AC1 save a draft` |
| AC1 | `packages/shared/tests/unit/eventDraft.test.ts` | `SCRUM-53/AC1 parseEventRequestDraft keeps what was sent` |
| AC1 | `services/event-service/tests/integration/eventDraftCreateRls.test.ts` | `SCRUM-53/AC1 create_event_draft stores a draft` |
| AC2 | `packages/shared/tests/unit/eventDraft.test.ts` | `SCRUM-53/AC2 parseEventRequestDraft ...` |
| AC2 | `services/event-service/tests/unit/event-draft-create.test.ts` | `SCRUM-53/AC2 ...` |
| AC2 | `services/event-service/tests/integration/eventDraftCreateRls.test.ts` | `SCRUM-53/AC2 ...` |
| AC3 | `services/event-service/tests/unit/event-draft-create.test.ts` | `SCRUM-53/AC3 ...` |
| AC3 | `services/event-service/tests/integration/eventDraftCreateRls.test.ts` | `SCRUM-53/AC3 ...` |
| AC4 | `services/event-service/tests/unit/event-draft-create.test.ts` | `SCRUM-53/AC4 ...` |
| AC4 | `services/event-service/tests/integration/eventDraftCreateRls.test.ts` | `SCRUM-53/AC4 ...` |

## Affected workspaces
- `supabase/migrations/52_event_drafts.sql` (new): organiser INSERT policy for drafts and `create_event_draft()`. Affects
  event-service only. No existing migration is edited.
- `services/event-service`: `routes/eventDrafts.ts`, mounted in `app.ts` before `eventRoutes`.
- `packages/shared`: `eventDraft.ts` (`parseEventRequestDraft`), exported from `index.ts`. Shared by services and web.
- `services/event-service/tests/integration/eventsRls.test.ts`: one existing test, `SCRUM-91 nobody creates … an event through the
  API yet`, inserted an event in the default (draft) state as an organiser and expected it to be refused. That is now allowed on
  purpose, so the insert asks for `status: "approved"`, which neither organiser policy permits (found when the integration suite
  was first run against migration 52).
- No C4 or ADR change: the container diagram already shows event-service owning event requests.

## Out of scope
- `apps/web`: no form, button, nav or page. The UI is SCRUM-124.
- Resume, re-save, submit from a draft, delete a draft (SCRUM-54, SCRUM-56); no organiser UPDATE or DELETE policy.
- Copying a past request into a new draft.

## Open questions
- None blocking. Week 9 says organisers cannot edit a submitted request; drafts are not submitted, so this does not conflict.

## Contract for SCRUM-124

`POST http://localhost:4002/events/drafts` with the `cs_session` cookie (`credentials: "include"`), JSON body, every field optional:

```json
{ "name": "", "purpose": "", "description": "", "preferred_start_datetime": null, "preferred_end_datetime": null,
  "expected_attendance": null, "venue_requirements": "", "preferred_room_layout_id": null,
  "accessibility_requirements": "", "equipment_requirements_notes": "", "registration_required": false,
  "registration_capacity": null, "registration_opens_at": null, "registration_closes_at": null }
```

- 201: the stored event row, including `id`, `name`, `status: "draft"`, `is_draft: true`, `submitted_at: null`, `created_at`, `updated_at` (the last-saved time) and the fields above.
- 401 `{ error: "Not signed in." }`; 403 `{ error: "You are not allowed to create event requests." }`.
- 422 `{ code: "VALIDATION_FAILED", error: "Check the highlighted fields.", fieldErrors: { field: message } }`.
- 500 `{ error: "Could not save the draft." }`.
- Each POST creates a new draft; saving the same draft again is SCRUM-54.
