# SCRUM-49 — Create and Submit a New Event Request

**Jira:** https://is212-g1t5.atlassian.net/browse/SCRUM-49
**Branch:** `SCRUM-49/create-submit-event-request`

## Story

As an `event_organiser`, I want to create and submit a new event request with all the required
event details so that Event Coordinators can review it and begin planning my event.

## Acceptance criteria

### AC1 — Capture required fields
- **Given** I am creating a new event request
- **When** I fill in the event name, purpose, description, preferred date and time, expected
  attendance, venue requirements, room layout, accessibility needs, equipment requirements, and
  registration setup
- **Then** the system stores this information against the new request

Notes from the story:
- All AC1 fields are mandatory.
- Equipment requirements and accessibility needs may be "None required".
- Registration setup requires at least whether attendee registration is needed.
- Multi-session events are out of scope (each session is a separate request).

### AC2 — Visual distinction
- **Given** I am filling in an event request
- **When** the form is displayed
- **Then** mandatory fields are visually distinguished from optional fields

### AC3 — Field-level validation
- **Given** a mandatory field is left empty
- **When** I move away from that field or attempt to submit
- **Then** the system flags that specific field as incomplete

### AC4 — Submit for review
- **Given** I have completed all mandatory fields
- **When** I choose to submit the request
- **Then** the request status becomes Submitted and it enters the unassigned queue for the Event
  Coordinator Lead (SCRUM-77)

### AC5 — Prevent incomplete submission
- **Given** one or more mandatory fields are missing or invalid
- **When** I attempt to submit the request
- **Then** the submission is blocked and I am shown which fields need correcting

### AC6 — Confirmation of submission
- **Given** a request has been submitted successfully
- **Then** I receive confirmation that my request was submitted, including the date and time of
  submission

### AC7 — Record ownership
- **Given** a request has been submitted
- **Then** the system records me as the Event Organiser associated with the request

Extra scenarios (error and edge cases):
- **Given** I am signed in as any role other than `event_organiser` (event coordinator, venue staff,
  technical support staff, attendee), **when** I try to create an event request, **then** it is
  refused with 403 and nothing is stored.
- **Given** I am not signed in, **when** I try to create an event request, **then** it is refused
  with 401 and nothing is stored.
- **Given** the request names an organiser (or a client organisation) in its body, **when** it is
  submitted, **then** the body value is ignored and I am recorded as the organiser.
- **Given** I belong to an organisation, **when** I submit a request, **then** that organisation is
  recorded as the request's client organisation, taken from my profile and never from the request
  body. *(Team design decision, not stated in the Jira ACs.)*

## AC → test mapping

Tests written so far: backend AC1, AC5 and AC7. AC5's 422 response copies `changeRequests.ts` (SCRUM-66).

| AC | Test file | `describe` / `it` |
| ----- | ----- | ----- |
| AC1 | `services/event-service/tests/unit/event-request-create.test.ts` | `SCRUM-49/AC1 — Capture required fields` / stores every AC1 field against the new request |
| AC1 | same | returns the id of the new request |
| AC1 | same | accepts "None required" for accessibility needs and equipment requirements |
| AC1 | same | stores a request that needs no attendee registration, with no capacity or registration window |
| AC7 | same | `SCRUM-49/AC7 — Record ownership` / records the signed-in organiser as the request's event organiser |
| AC7 | same | ignores an organiser_id sent in the request body |
| AC7 | same | records the organiser's own organisation as the client, ignoring one sent in the body |
| AC7 | same | refuses a request with no login with 401, and stores nothing |
| AC7 | same | refuses a `event_coordinator` with 403, and stores nothing |
| AC7 | same | refuses a `venue_staff` with 403, and stores nothing |
| AC7 | same | refuses a `technical_support_staff` with 403, and stores nothing |
| AC7 | same | refuses a `attendee` with 403, and stores nothing |
| AC5 | `packages/shared/tests/unit/eventRequest.test.ts` | `SCRUM-49/AC5 eventRequestSchema accepts a complete request`, `every AC1 field is mandatory`, `dates`, `numbers`, `registration setup`, `all bad fields are reported together` |
| AC5 | `services/event-service/tests/unit/event-request-create.test.ts` | `SCRUM-49/AC5 — Prevent incomplete submission` / refuses a missing or bad field with 422 `VALIDATION_FAILED` listing each field, and stores nothing |
| AC2 | — | not yet written (apps/web) |
| AC3 | — | not yet written (apps/web, shared schema) |
| AC4 | — | not yet written (event-service) |
| AC5 | — | apps/web form display of the field errors not yet written |
| AC6 | — | not yet written (event-service, apps/web) |

## Affected workspaces

- `services/event-service` — new `POST /events` route in its own routes file; CORS must allow `POST`.
- `packages/shared` — request validation schema (first zod schema there) and a role helper for who
  may create requests, so `apps/web` and the service validate identically. Flag in the commit body.
- `apps/web` — the request form, field validation and confirmation (AC2, AC3, AC6), later.
- `supabase/migrations/` — **one new migration, `49_create_event_request.sql`** (numbered after
  `48_venue_booking_replacement.sql`, the last migration on `main` when this branch merged it).
  `events.venue_requirements` (AC1) is not added here: `34_edit_event_details.sql` owns it. It adds:
  - a `create_event_request` function that creates the event and its `event_status_history` row in
    one transaction, taking the organiser from `auth.uid()` (AC7)
  - organiser-only INSERT policies on `events` and `event_status_history`, so RLS enforces the
    "organisers only" rule (AC7): an `event_organiser` can insert only rows where they are the
    organiser, with status `submitted`. `14_events_rls.sql` left both tables with no INSERT policy
    for organisers. Covered by `services/event-service/tests/integration/eventRequestCreateRls.test.ts`.
- The route still checks the role in application code (`canCreateEventRequests`), now as
  defence-in-depth behind RLS. It gives a clean 403 instead of a raw database error. Raised as a
  question for PR review (see Open questions); it has not been removed.
- No C4 diagram or ADR change expected.

## Out of scope

- Assigning a coordinator (SCRUM-42, SCRUM-77). AC4 only requires the request to reach `submitted`
  with no coordinator assigned, so it waits in the Event Coordinator Lead's unassigned queue.
- Notifications on submission (feature 20).
- Saving as a draft (SCRUM-53). The schema already allows `draft`.
- Multi-session events; each session is a separate request.
- Listing and viewing submitted requests (SCRUM-22, SCRUM-23).

## Decisions

- **App-level role check stays.** `canCreateEventRequests` in `routes/eventRequests.ts` is kept as
  defence-in-depth behind RLS, for a clean 403. Still raised as a question in the PR.
- **Registration setup.** When registration is needed (Yes), capacity and the opens/closes window are
  mandatory. Opens must be before closes, and closes by the event start. Capacity is at least 1.
- **Room layouts** come from the `room_layouts` table (one choice, `preferred_room_layout_id`).
- **Dates.** The preferred start must be in the future and the end after the start. No minimum notice
  beyond that; this is still an open question for the customer.
- **Editing after submit** is done through an event change request (SCRUM-66), not by editing the request.
- **Event category is out of scope.** `events.event_category_id` is nullable in `01_schema.sql`, so
  `events` does not require it and the form does not collect it.
- **Other roles refused.** All six non-organiser roles get 403, including `event_coordinator_lead` and
  `safety_officer`.

## Open questions

- **Date lead time.** Is any minimum notice period needed beyond a future start? For the customer.
