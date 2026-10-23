# SCRUM-52 — View My Submitted Event Requests

**Jira:** SCRUM-52 (Event Request Creation)
**Branch:** `SCRUM-52/my-event-requests-page`

## Story

As an `event_organiser`, I want to view a list of all the event requests I have submitted so that I can track their progress.

## Acceptance criteria

### AC1 — List own requests
- **Given** I am logged in as an Event Organiser
- **When** I navigate to my event requests
- **Then** I see all requests I have created, including their current status.

Scenarios:
- S1: the page `/my-event-requests` (nav entry "My event requests") lists every request of the organiser, newest created first, each with name, status badge, preferred start, expected attendance and submitted date; each row links to `/events/<id>`. There is no 25-row cap (ceiling 500).
- S2: an organiser with no requests is told so.
- S3: `GET /events/my-requests` (event-service) returns those rows for an organiser.
- S4: any other role gets 403; no session gets 401.
- S5: when the list cannot be loaded (403 or failure) the page shows event-service's message, not "no requests".
- Drafts appear like any other status; no draft-specific behaviour (SCRUM-53/55).

### AC2 — Restrict visibility
- **Given** I am an Event Organiser
- **When** I view my event requests list
- **Then** I only see requests that I created, not those created by other Organisers.

Scenarios:
- S1: with another organiser's events in the data, `GET /events/my-requests` returns only the caller's.
- S2: the query is made as the caller (RLS policy `events_select`, migration 14, is the real boundary) and also filters on `organiser_id`.

### AC3 — Access request details
- **Given** I select a specific request from my list
- **When** the request loads
- **Then** I see the full details I submitted, including any updates made during review.

Scenarios:
- S1: `/events/<id>` shows the full request (`EventRequestDetails`) to its organiser.
- S2: the "Changes & history" tab shows the change history (`event_change_history`, SCRUM-111) to the organiser, so updates made during review are visible.

## AC → test mapping

| AC | Test file | `describe` / `it` |
| ----- | ----- | ----- |
| AC1 | `services/event-service/tests/unit/my-event-requests.test.ts` | `SCRUM-52/AC1 …` |
| AC1 | `apps/web/tests/unit/my-event-requests-page.test.tsx` | `SCRUM-52/AC1 My event requests page`, `SCRUM-52/AC1 reaching the page` (nav entry, dashboard link) |
| AC1 | `apps/web/tests/unit/my-event-requests-server.test.ts` | `SCRUM-52/AC1 loading my event requests` |
| AC2 | `services/event-service/tests/unit/my-event-requests.test.ts` | `SCRUM-52/AC2 …` |
| AC2 | `services/event-service/tests/integration/myEventRequestsDb.test.ts` | `SCRUM-52/AC2 …` |
| AC3 | `apps/web/tests/unit/my-event-requests-details.test.tsx` | `SCRUM-52/AC3 …` |

## Affected workspaces

- `services/event-service`: new route `routes/myEventRequests.ts`, mounted before `eventRoutes` in `app.ts` (so `my-requests` is not read as an `:id`).
- `apps/web`: new page `app/my-event-requests`, server helper `lib/myEventRequestsServer.ts`, nav entry in `lib/nav.ts`, a "View all" link on the dashboard section.
- No migration. No `packages/shared` change. No C4 or ADR change.

## Out of scope

- Draft behaviour, filters or grouping (SCRUM-53/55).
- Search, sorting controls and pagination.
- A role-only route guard: the API's 403 message is shown instead.

## Open questions

- None.
