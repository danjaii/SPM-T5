# SCRUM-55 — Distinguish Draft Requests from Submitted Requests

**Jira:** SCRUM-55 (Event Request Creation)
**Branch:** `SCRUM-55/distinguish-draft-requests`

## Story

As an `event_organiser`, I want to tell my draft requests apart from the ones I have submitted, and filter the list by status, so that I know which ones still need my attention.

## Acceptance criteria

### AC1 — Status shown on every request
- **Given** I am an Event Organiser viewing My event requests
- **When** the list loads
- **Then** each request shows its status (Draft, Submitted, ...) clearly.

Scenarios:
- S1: every row has a Status cell that renders the shared `EventStatusBadge` (tone, icon and label, never colour alone).
- S2: a status the app does not know is shown by its raw value, still with an icon.
- Already true since SCRUM-52; this story adds the tests that keep it true.

### AC2 — Drafts are visually distinguished
- **Given** my list holds drafts and submitted requests
- **When** I look at it
- **Then** a draft is visibly different from a submitted request.

Scenarios:
- S1: a draft row has a light background and its name carries the text "Not submitted yet" beneath it; the Submitted column reads "Not submitted" instead of a dash.
- S2: a draft saved without a name (blank, or the placeholder "Untitled draft") shows as "Untitled draft" in muted italic text, still linking to the request.
- S3: a non-draft row (any other status) has none of these.
- The difference is a label and a tint, in addition to the Draft badge, so it is not colour alone. The list keeps event-service's order (newest first); drafts are not moved into a separate group, so the order matches what the organiser last touched.

### AC3 — Filter by status
- **Given** my list holds requests in several statuses
- **When** I choose a status in the filter
- **Then** only requests with that status are shown.

Scenarios:
- S1: above the table, a row of toggle chips: "All" (default, selected) and one chip per status present in the list, in lifecycle order, each with its count. A selected chip shows a tick.
- S2: choosing a chip shows only requests of that status; choosing "All" shows every request again.
- S3: the chip with the current choice is `aria-pressed`; only one chip is chosen at a time.
- S4: the filter runs in the browser over the list already loaded; no new request is made.
- S5: with a filter chosen, if no row matches (cannot happen with present-status chips, kept as a safe fallback) the page says "No requests match this status."
- S6: with no requests at all there is no filter; the existing empty message stays.

## AC → test mapping

| AC | Test file | `describe` / `it` |
| ----- | ----- | ----- |
| AC1 | `apps/web/tests/unit/my-event-requests-status.test.tsx` | `SCRUM-55/AC1 each request shows its status clearly` |
| AC2 | `apps/web/tests/unit/my-event-requests-status.test.tsx` | `SCRUM-55/AC2 drafts are visually distinguished` |
| AC3 | `apps/web/tests/unit/my-event-requests-status.test.tsx` | `SCRUM-55/AC3 filter by status` |

## Affected workspaces

`apps/web` only: `MyEventRequestsTable.tsx`, a new `MyEventRequestsList.tsx` (filter), `lib/myEventRequests.ts` (helpers) and the page. No migration, no service change, no diagram change. `GET /events/my-requests` already returns `name`, `status` and `submitted_at`, which is all that is needed.

## Out of scope

- Deleting a draft (SCRUM-56), resuming or editing a draft (SCRUM-53/54).
- Search by name, sorting, or filtering on anything but status.
- Saving a draft without a name: where the placeholder "Untitled draft" is written is the draft-saving story's job; this story only displays it sensibly.

## Open questions

- Should drafts be grouped above submitted requests? Not done: the filter already gives a drafts-only view and reordering would hide recent activity.
