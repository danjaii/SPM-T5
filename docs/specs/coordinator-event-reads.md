# Coordinators Read Only the Events Assigned to Them: Final User Story

User story for **Coordinators read only the events assigned to them** (ConnectSphere, IS212), compiled 2026-10-29.

- Scenario numbers are the test IDs: `156-S3` means SCRUM-156, Scenario 3.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-156 | [User Authorisation & Authentication] Coordinators read only the events assigned to them | `07_venue_bookings_rls.sql` (helpers), `08_event_review_tables.sql`, `14_events_rls.sql`, `21_lead_unassigned_queue.sql`, `22_lead_coordinator_overview.sql` |

Why: the customer says access follows "the user's role and direct relationship to an event" (Week 9 answers, row 15), that
coordinators "only manage events assigned to them by the Lead" (row 36) and that the unassigned queue belongs to Leads
(row 61). Today `events_select` (migration 14) lets every coordinator read every non-draft event, and
`user_can_access_event()` (migration 08) lets every coordinator read the comments, mentions, attachments, status history,
coordinator history, documents and change requests of every event. SCRUM-91 chose that before these answers. See ADR 0003.

## Implementation decisions (2026-10-29)

These override the text of the Jira ticket where they conflict.

- **A coordinator reads an event only when assigned to it [DECIDED].** `events_select` and `events_update_coordinator` use
  `assigned_coordinator_id = auth.uid()` for the `event_coordinator` role. The draft clause goes: an assigned coordinator
  already satisfies the new rule, and an unassigned draft is nobody's but its organiser's. The `with check` of the update
  policy is unchanged. Migration 59 drops and re-creates the two policies; migration 14 is not edited.
- **The helper follows [DECIDED].** `user_can_access_event(user, event)` returns true for the event's organiser and for
  the event's assigned coordinator, no longer for any coordinator. Every policy that calls it narrows with it: comments,
  mentions, attachments, the `event-attachments` storage bucket, status history, coordinator history, documents, change
  requests. It is `create or replace`, so those policies are not re-created. `event_sessions` uses an inline subquery on
  `events` and so follows by itself.
- **A reassigned event moves with the coordinator [DECIDED, the ticket's default].** The new coordinator reads the event
  and its whole history; the previous one reads none of it. Nothing is copied or deleted. The Lead's notification to the
  previous coordinator (migration 50) is unchanged and does not link to the event.
- **The people a comment can mention are the event's own [DECIDED].** A mention must target someone for whom
  `user_can_access_event()` is true, so `GET /events/:id/mentionable-users` offers the event's organiser and its assigned
  coordinator (never the caller), no longer every coordinator. Otherwise the list offers people the database then refuses.
- **The Lead is left as it is [DECIDED].** A Lead reads unassigned submitted events (migration 21) and the events of their
  own linked coordinators (migration 22). Neither policy is touched. The ticket and ADR 0003 say Leads see all events
  system-wide (W9 r37), which the database does not do today: a Lead cannot read events of coordinators linked to another
  Lead, nor the comments and history of any event. This story keeps AC6 ("what a Lead sees is unchanged") and flags the
  gap in the PR; closing it is a separate story.
- **Other roles are unchanged [DECIDED].** Organisers, Venue Staff, Technical Support Staff and attendees keep the
  clauses in `events_select` they have. Safety Officers still read through `security definer` functions.
- **Consumers audited.** Already limited to the assigned coordinator, so unchanged: the review queue (`GET /events`),
  `GET /events/my-events`, `/registrations-overview` (`GET /events/managed`), the coordinator dashboard, venue-service's
  event reader, event details, change request review, status change, approve and reject. `GET /events/:id`,
  `/outcome` and `/comments` read through the caller's client, so a coordinator who is not assigned gets the same 404 as
  for an event that does not exist. equipment-service's `list()` reads whatever the caller may see, which now narrows for
  coordinators, who were already refused everything but their own events there. The only code change is
  `mentionable-users`.
- **Migration** `59_coordinator_event_reads.sql`. The header holds the role-by-action matrix. No `packages/shared`
  change. **[DECIDED]**
- **Not in scope.** Giving Leads system-wide reads or access to comments and history; narrowing reads of reference data;
  a history view for a previous coordinator.

### Role-by-action matrix

Only the rows that change. Every other role and table keeps what migrations 14, 21 and 22 gave it.

| Who | `events` SELECT, before | `events` SELECT, now | Comments, mentions, attachments, history, documents, change requests, before | now |
| --- | --- | --- | --- | --- |
| Coordinator assigned to the event | the event | the event | the event | the event |
| Any other coordinator | every non-draft event | none | every event | none |
| Coordinator after a reassignment (previous one) | the event | none | the event | none |
| Organiser of the event | the event | the event | the event | the event |

`events` UPDATE (status, `assigned_coordinator_id` columns) narrows the same way: the assigned coordinator only.

### Jira wording

- AC2 reads "not-found or forbidden"; the route answers 404 (the event looks like one that does not exist).
- Add to AC4: "and their comments and history".
- The ticket's branch name is `SCRUM-156/coordinator-event-reads`, which is the one used.

---

## SCRUM-156 Coordinators read only the events assigned to them

**User story.** As an Event Organiser, I want only the coordinator assigned to my event (and the Lead) to be able to read
it, so that coordinators who have not been given my event cannot see it.

### Acceptance criteria

*AC1.* Given I am a coordinator, when I query `events` directly, then I only get the events assigned to me.

*AC2.* Given I am a coordinator and an event is not assigned to me, when I open it (`GET /events/:id` or its page), then I
get a not-found response, not its details.

*AC3.* Given I am a coordinator, when an event is unassigned, then I cannot see it; only Leads see the unassigned queue.

*AC4.* Given an event is reassigned, when the new coordinator opens it, then they can, and the previous coordinator can no
longer.

*AC5.* Given I am the assigned coordinator, when I review, comment, change status, edit details or handle a change request,
then it all works as before.

*AC6.* Given I am a Lead, Venue Staff, Technical Support Staff, an organiser or an attendee, when I read events, then what I
can see is unchanged.

### Tests

"Another coordinator" is a coordinator the event is not assigned to. Roles are the seven in `packages/shared/src/roles.ts`.

| ID | Scenario | Level | File (proposed) |
| --- | --- | --- | --- |
| 156-S1 | A coordinator reading `events` gets the events assigned to them and none assigned to another coordinator | integration | `services/event-service/tests/integration/coordinatorEventReads.test.ts` |
| 156-S2 | A coordinator cannot read the comments, mentions, status history, coordinator history, documents or change requests of an event that is not assigned to them, nor its sessions | integration | same |
| 156-S3 | An unassigned submitted event, and an unassigned draft, are invisible to every coordinator; a Lead still reads the submitted one | integration | same |
| 156-S4 | After a Lead reassigns an event, the new coordinator reads it and its comments and history, and the previous coordinator reads none of them | integration | same |
| 156-S5 | The assigned coordinator still comments, mentions the organiser, changes status and reads the history; another coordinator cannot update the event or comment on it | integration | same |
| 156-S6 | A coordinator cannot be mentioned on an event they are not assigned to (the mention is refused); the organiser and the assigned coordinator can | integration | `eventReviewRls.test.ts` (existing mention tests, updated) |
| 156-S7 | A Lead, Venue Staff, Technical Support Staff, the organiser and a registered attendee read exactly what they read before | integration | `eventsRls.test.ts` (existing tests, re-run) |
| 156-S8 | `GET /events/:id`, `/outcome` and `/comments` answer 404 or an empty list for an event that is not assigned to the coordinator | unit | `services/event-service/tests/unit/event-review.test.ts` |
| 156-S9 | `GET /events/:id/mentionable-users` offers the event's organiser and assigned coordinator, never another coordinator or the caller | unit | same |

Fixtures are created with the secret key, prefixed `IT-`, and removed afterwards; assertions only cover rows the test
creates (CLAUDE.md, SCRUM-143). Reassignment in 156-S4 goes through `lead_reassign_coordinator()` with a Lead and two
coordinators the test creates, as `leadReassign.test.ts` does.
