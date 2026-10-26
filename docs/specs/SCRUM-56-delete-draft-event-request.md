# SCRUM-56 — Delete a Draft Event Request

**Jira:** SCRUM-56 (Draft Event Requests)
**Branch:** `SCRUM-56/delete-draft-event-request`

## Story

As an `event_organiser`, I want to delete a draft event request I no longer need so that my list of event requests stays relevant and manageable.

## Acceptance criteria

### AC1 — Delete own draft
- **Given** I have a saved draft
- **When** I choose to delete it
- **Then** the draft is permanently removed from my list of event requests.

Scenarios:
- S1: `DELETE /events/drafts/:id` by the draft's organiser removes the `events` row for good (a real database delete, no soft-delete column) and answers 204 with no body.
- S2: the draft no longer appears in `GET /events/my-requests`, and the My event requests page refreshes its list after the delete.
- S3: the delete is made by the security definer function `delete_event_draft(p_event_id)` (migration 55), called as the caller (`deps.forUser(token)`), never with the service-role key. `authenticated` has no DELETE privilege on `events` (migration 14) and keeps none, so the function is the only way in. A direct `delete from events` as the organiser is still refused.
- S4: no session is 401; a role that cannot create event requests (`canCreateEventRequests`) is 403.
- S5: an id that is not a uuid is 404 and the database is not asked. A draft that does not exist, or belongs to another organiser, is 404 with the same body (the caller cannot tell the two apart; database error `DR001`).
- S6: any other database failure is 500 "Could not delete the draft." and nothing is reported as deleted.
- S7 (child rows, decision): every table that references `events(id)` does so with `on delete cascade` (event_status_history, event_coordinator_history, event_sessions, event_change_requests, event_comments and their mentions and attachments, event_documents, venue_bookings, equipment_reservations, technical_support_requests, event_registrations, notifications, coordinator_assignment_logs, event_change_history, safety_checks), so a draft's own rows go with it and nothing is orphaned. A draft normally has none (only the history row of a submitted request exists). The one reference without a cascade is `events.cloned_from_event_id` (a copy points at its source). Copies are made from completed or past requests (customer clarification Q4, week 9), never from a draft, so no draft is referenced; if one ever were, the foreign key refuses the delete (SQLSTATE 23503), the draft stays, and the route answers 500 rather than leaving a copy pointing at nothing. The function does not null that column on other organisers' rows.

### AC2 — Prevent deletion of submitted requests
- **Given** a request has already been submitted
- **When** I attempt to delete it through this action
- **Then** the delete option is not available (only drafts can be deleted this way).

Scenarios:
- S1: `DELETE /events/drafts/:id` for the organiser's own request that is no longer a draft (status other than `draft`, or `is_draft` not true) is 409 `{ "code": "NOT_A_DRAFT", "error": "This request has been submitted, so it can no longer be deleted." }` (database error `DR002`), and the row is untouched.
- S2: in the My event requests table the Delete control is rendered only on rows whose status is `draft`. A row with any other status (submitted, under review, approved, planning, confirmed, completed, cancelled, rejected, returned, and an unknown status) has no Delete control at all.
- S3: the database enforces it too: `delete_event_draft` raises `DR002` itself, so a stale page or a hand-made request cannot delete a submitted request.

### AC3 — Confirmation prompt
- **Given** I choose to delete a draft
- **When** I initiate the deletion
- **Then** I am asked to confirm before the draft is permanently removed.

Scenarios:
- S1: choosing Delete on a draft row opens a dialog (the shadcn `Dialog`, as `WithdrawRegistration` does) titled "Delete this draft?" naming the draft and saying "This can't be undone", with Cancel and Delete buttons. No request has been sent yet.
- S2: Cancel (or closing the dialog) closes it, sends nothing and leaves the draft in the list.
- S3: Delete sends `DELETE ${EVENT_URL}/events/drafts/:id` with `credentials: "include"`, shows progress ("Deleting…", button disabled so it is sent once), and on success closes the dialog and refreshes the list (`router.refresh()`).
- S4: on failure (409, 404, 500 or the network) the dialog stays open, shows the server's message (or "We couldn't reach the server. Please try again." offline) in an alert, and the draft stays.
- S5: the control is a small reusable client component, `DeleteDraftButton`, so the drafts list (SCRUM-124) can use it. The row's button has an accessible name that names the draft ("Delete draft Tech Summit"), a visible keyboard focus ring (shadcn `Button`), and the row stays usable at 375 px.

## Decisions

- Real delete, no soft-delete column ("permanently removed").
- Security definer function rather than an RLS DELETE policy: `authenticated` has no DELETE privilege on `events` (migration 14: writes go through security definer functions so history and guards cannot be bypassed), so a policy would be unreachable ("permission denied for table events"). Granting DELETE is rejected: it would let an assigned coordinator delete events directly.
- Same SQLSTATEs as 53/54: `DR001` not found or not the caller's, `DR002` not a draft; `42501` for a caller who is not an event organiser.
- 204 on success (nothing the page needs back). Non-uuid id is 404 (as the draft routes of SCRUM-54 do).
- Route in its own file, `routes/eventDraftDelete.ts`, mounted before `eventRoutes`, so it does not collide with the draft routes in `eventDrafts.ts` that SCRUM-53 and SCRUM-54 add.
- The delete is a button on the existing My event requests table (SCRUM-52). The drafts list, Save draft button and resume screen are SCRUM-124, not built here. No change to the new-request form.

## AC → test mapping

| AC | Test file | `describe` / `it` |
| ----- | ----- | ----- |
| AC1 | `services/event-service/tests/unit/event-draft-delete.test.ts` | `SCRUM-56/AC1 delete a draft (DELETE /events/drafts/:id)` |
| AC1 | `services/event-service/tests/integration/eventDraftDeleteDb.test.ts` | `SCRUM-56/AC1 the owner deletes their draft` |
| AC1 | `apps/web/tests/unit/delete-draft.test.tsx` | `SCRUM-56/AC1 deleting a draft from My event requests` |
| AC2 | `services/event-service/tests/unit/event-draft-delete.test.ts` | `SCRUM-56/AC2 a submitted request cannot be deleted` |
| AC2 | `services/event-service/tests/integration/eventDraftDeleteDb.test.ts` | `SCRUM-56/AC2 a submitted request cannot be deleted` |
| AC2 | `apps/web/tests/unit/delete-draft.test.tsx` | `SCRUM-56/AC2 only drafts have a Delete control` |
| AC3 | `apps/web/tests/unit/delete-draft.test.tsx` | `SCRUM-56/AC3 confirmation prompt` |

(Kept current as tests are added.)

## Affected workspaces

- `supabase/migrations/55_delete_event_draft.sql`: new function `delete_event_draft()`. Migration numbering and merge order: the draft stories SCRUM-53 and SCRUM-54 use 52 to 54 on their own branches and the calendar story uses 58; 55 is free, and this migration must merge after 53 and 54 only for tidiness (it does not call anything they add: it works on any `events` row with `status = 'draft'`).
- `services/event-service`: new `routes/eventDraftDelete.ts`, mounted in `app.ts`.
- `apps/web`: new `components/DeleteDraftButton.tsx`, `lib/draftDelete.ts` (the fetch), used by `MyEventRequestsTable`.
- No `packages/shared` change, no C4 or ADR change.

## Out of scope

- Drafts list, Save draft, resume screen, "Draft" styling and status filter (SCRUM-53, 54, 55, 124, 130).
- Deleting submitted requests (they are withdrawn through the coordinator; customer clarification week 9 Q6).
- Undo or a recycle bin.

## Open questions

- None blocking. `cloned_from_event_id` (see S7) is documented, not handled.
