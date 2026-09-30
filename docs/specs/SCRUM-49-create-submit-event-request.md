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
- **Then** the request status changes to Submitted and it becomes available for coordinator
  auto-assignment and review (see SCRUM-42)

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

Tests written so far (red step, backend AC1 + AC7). AC2–AC6 have no tests yet.

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
| AC2 | — | not yet written (apps/web) |
| AC3 | — | not yet written (apps/web, shared schema) |
| AC4 | — | not yet written (event-service) |
| AC5 | — | not yet written (event-service, shared schema, apps/web) |
| AC6 | — | not yet written (event-service, apps/web) |

## Affected workspaces

- `services/event-service` — new `POST /events` route in its own routes file; CORS must allow `POST`.
- `packages/shared` — request validation schema (first zod schema there) and a role helper for who
  may create requests, so `apps/web` and the service validate identically. Flag in the commit body.
- `apps/web` — the request form, field validation and confirmation (AC2, AC3, AC6), later.
- `supabase/migrations/` — **one new migration, `08_create_event_request.sql`**. Numbered 08 because
  the unmerged `event-review-and-approval` branch (Jerome) already uses 04–07, while `main` only has
  04 (`04_change_event_status.sql`). That clash with `main`'s own 04 is Jerome's to resolve at merge;
  flag it in the PR. It adds:
  - a `venue_requirements` text column on `events` (AC1 lists venue requirements; no column holds it)
  - a `create_event_request` function that creates the event and its `event_status_history` row in
    one transaction, taking the organiser from `auth.uid()` (AC7)
- The "organisers only" check (AC7 scenario above) is done in application code in the route, not RLS,
  because RLS is still a blanket placeholder. Note in the PR; replace with an RLS policy later.
- No C4 diagram or ADR change expected.

## Out of scope

- Coordinator auto-assignment (SCRUM-42). AC4 only requires the request to reach `submitted`.
  Note: SCRUM-42 as built on `event-review-with-approval` is manual assignment by a coordinator.
- Notifications on submission (feature 20).
- Saving as a draft (SCRUM-53). The schema already allows `draft`.
- Multi-session events; each session is a separate request.
- Listing and viewing submitted requests (SCRUM-22, SCRUM-23).

## Open questions

- **Registration setup contents.** Beyond whether registration is needed, are capacity and the
  opens/closes window mandatory when it is? (Current tests and plan assume yes when required.)
- **Room layout options.** Which layouts can be chosen: all rows in `room_layouts` (six seeded), or
  only those a venue supports? Is a single choice enough?
- **Date lead time.** Must the preferred start be in the future, and is there a minimum notice
  period? (Current plan assumes future start, end after start, no minimum notice.)
- **Editing after submit.** Can an organiser edit a request once it is `submitted`, or only via a
  change request (feature 19)?
- **Event category.** `events.event_category_id` exists and categories are seeded, but AC1 does not
  list it. Is it collected at creation, and is it mandatory?
