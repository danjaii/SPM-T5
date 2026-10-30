# Notifications: Receive Relevant Notifications

User story for **Receive Relevant Notifications** (ConnectSphere, IS212), compiled 2026-10-17.

- Scenario numbers are the test IDs: `47-S4` means SCRUM-47, Scenario 4 (here scenario n is AC n).
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-47 | [Notification System] Receive Relevant Notifications | SCRUM-46 (`notifications`, migration 35, [notifications.md](notifications.md)), [ADR 0002](../architecture/adr/0002-in-app-notifications-outbox.md), Lead assign / reassign (migrations 23, 24), `change_event_status()` (migration 04), comments and mentions (SCRUM-25/27, migration 08), safety decisions (SCRUM-99/100, migrations 37, 43) |

Out of scope: email/SMS delivery, telling the coordinator who was replaced, other status changes (submitted, confirmed…),
"ready for a safety check" to Safety Officers, a revoked Safety Approval (SCRUM-100/AC9), and SCRUM-106.

## Implementation decisions (2026-10-17)

These override the text below where they conflict.

- **Producers are SQL, in one migration, `44_notification_producers.sql`.** Each notification is written by a trigger in
  the same transaction as the change it announces (ADR 0002), so a refused or rolled-back change leaves none (AC10). Every
  row has `event_id`, so SCRUM-46's link to the event, and its no-access wording, apply unchanged. **[DECIDED]**
- **Never the person who did it (AC8).** Replying to your own comment, or mentioning yourself, notifies nobody. **[DECIDED]**
- **AC1 assignment.** `trg_notify_coordinator_assignment`, after insert on `coordinator_assignment_logs` (written by
  `lead_assign_coordinator()` and `lead_reassign_coordinator()`): the new coordinator gets `coordinator_assigned`. The
  replaced coordinator is not told. **[DECIDED]**
- **AC4/AC5 approval and rejection.** `trg_notify_event_decision`, after insert on `event_status_history`, so both
  `POST /events/:id/approve|reject` and `PATCH /events/:id/status` are covered: the organiser gets `event_approved` or
  `event_rejected`, the latter with the coordinator's reason. A "change" to the status the event already has is not a
  decision and notifies nobody (AC10). **[DECIDED]**
- **Comments (AC6, AC7, AC9).** `post_event_comment(p_event_id, p_body, p_parent_comment_id, p_mentions)` saves a comment
  and its mentions in one transaction. It is `security invoker`, so migration 08's policies still decide who may comment
  and whom they may mention. `POST /events/:id/comments` calls it instead of inserting the rows one by one; attachments
  are still inserted afterwards by the route. A **deferred** constraint trigger on `event_comments`
  (`trg_notify_new_comment`) runs at commit, when the mentions exist, and gives each person mentioned, and the author of
  the comment replied to, **one** notification: `comment_mention` if they were mentioned, else `comment_reply`. **[DECIDED]**
- **A refused comment is reported (AC10).** If the database refuses `post_event_comment()` (for example a mention of
  someone who cannot see the event), the route answers 403 "You can't post this comment. Check that everyone you
  mentioned can see this event." and saves no attachment; before, it answered 201. **[DECIDED]**
- **Action needed (AC11).** `notificationRequiresAction(type)` in `packages/shared/src/notifications.ts`: true for
  `coordinator_assigned`, `comment_mention`, `safety_changes_requested`, `clarification_requested` and
  `clarification_answered`, false for every other type, known or not.
  notification-service returns it as `actionRequired` on every item, and `/notifications` shows an "Action needed" badge.
  No schema change. **[PROPOSED]**
- **The notification bell (AC11).** Every signed-in page's header (`AppHeader`, which replaced the header each page
  copied) has a bell beside the user's role (on dashboards) and Log out. It shows the unread count (`99+` above 99, none
  when 0 or the service is down) and, when clicked, a dropdown of the notifications, newest first: title, "Unread",
  "Action needed", the related event or the no-access wording, and the time; the list scrolls after about 8 rows.
  Choosing one marks it read, then opens its page; "View all notifications" opens `/notifications`, which keeps Mark as
  read and Acknowledge. Closes on Escape or a click elsewhere. The bell reads notification-service from the browser
  (`fetchUnreadCount`, `fetchNotifications`), so no page loads notifications on the server; this replaced the dashboard's
  "Notifications (n unread)" link and the server-side `getUnreadCount()`. **[DECIDED]**
- **AC12 safety decision** (proposed AC below, to be added to SCRUM-47 in Jira). `trg_notify_safety_decision`, after
  insert on `safety_checks` (written by `record_safety_decision()`): the event's coordinator and organiser each get
  `safety_approved`, `safety_rejected` or `safety_changes_requested`, with the reason or the requested changes. Request
  Changes also moves the event to planning; that status row notifies nobody. **[DECIDED]**
- **Clarification (AC2, AC3) is a flagged comment** (chosen 2026-10-17 over returning the event, which had no
  organiser resubmit flow for AC3). `event_comments.is_clarification_request`, set through `post_event_comment(…,
  p_clarification_request)`; only the event's assigned coordinator may set it (42501 otherwise). The organiser gets
  `clarification_requested`. The organiser's reply to that comment gives the assigned coordinator
  `clarification_answered`; anyone else's reply is an ordinary `comment_reply`. Ranking for one notification per person:
  answer > request > mention > reply. On the page, the assigned coordinator (`can_request_clarification` from
  `GET /events/:id/comments`) gets an "Ask the organiser for clarification" box on a new comment, and such a comment shows
  "Clarification requested"; the organiser answers with Reply. Both types need action. **[DECIDED]**
- **Types.** `NOTIFICATION_TYPES` gains `event_approved`, `event_rejected`, `comment_mention`, `comment_reply`,
  `safety_approved`, `safety_rejected`, `safety_changes_requested`, `clarification_requested` and
  `clarification_answered`. **[DECIDED]**

## Implementation decisions for SCRUM-172 (2026-10-30)

SCRUM-172 adds the producers SCRUM-47 left out, in `65_notification_producers_remaining.sql`, with the same pattern. Who hears
of AC6, AC7 and AC8 has customer backing (W9 r19, r47, r52). The recipients of AC1 to AC5 do not. **[PROPOSED]**

- **Never the person who did it.** Only AC3 says so, but the team applied it to every criterion, so a coordinator who confirms
  or cancels an event is not told, and neither is an attendee who withdraws. This departs from the wording of AC4, AC5 and AC6.
  Withdrawing is the only registration status change in the app today, so AC4 is proven by a database test and reaches people
  once SCRUM-169 adds the organiser's confirm and decline. **[DECIDED]**
- **AC1, AC5, AC6 are on `event_status_history`**, in `notify_event_status_change()`, beside migration 44's decisions. A request
  counts as submitted from no status, `draft` or `returned`, so moving an event back during review does not. A row that does not
  match the event's current status is ignored, because migration 14's policy lets a coordinator insert history rows directly.
  **[DECIDED]**
- **AC3 is on `event_change_history`** where `is_important`, so a change request the coordinator approves counts as well. The
  message names the fields as `EVENT_FIELD_LABELS` does; a test keeps the two equal. **[DECIDED]**
- **AC4 is on `event_registrations`**, in the attendee's words (Pending, Confirmed, Rejected, Withdrawn). **[DECIDED]**
- **AC2 is a Pending request becoming approved or rejected.** The notice opens the booking. **[DECIDED]**
- **AC7 is one notification per flagged booking**, however many bookings it clashes with, through a statement trigger on
  `venue_booking_flags`. It uses the `venue_booking_flagged` type, titled "Buffer conflict", and never names the other event.
  **[DECIDED]**
- **AC8 fires when a booking becomes `replaced`**, which only happens for a real replacement, so an ordinary amendment does not
  announce one. The coordinator hears through AC2. **[DECIDED]**
- **AC9.** `event_update_attendees()` is the database's copy of `receivesEventUpdates()`: `waitlisted` and `registered` only. A
  test keeps the two equal for all four statuses. A registration already withdrawn notifies nobody when it changes. **[DECIDED]**
- **An attendee's event notification opens `/registrations`.** They can see the event's name, but `GET /events/:id` refuses them.
  **[DECIDED]**
- **Action needed** adds `event_submitted` (a Lead assigns a coordinator) and `venue_booking_rejected` (the coordinator finds
  another venue). **[PROPOSED]**
- **Types.** `NOTIFICATION_TYPES` gains `venue_booking_approved`, `venue_booking_rejected`, `event_changed`,
  `registration_status_changed`, `event_cancelled` and `venue_replaced`. **[DECIDED]**
- **For whoever builds the cancel route** (`REQUIREMENTS_STATUS.md` task 4): if cancelling also moves registrations to
  `cancelled`, an attendee gets both `event_cancelled` and `registration_status_changed` unless that work prevents it.

---

## SCRUM-47 Receive Relevant Notifications

**User story.** As a user, I want to receive notifications when important events or changes relevant to me occur, so that
I can stay informed and take timely action where necessary.

### Acceptance criteria

*AC1 - Coordinator assignment.* Given I am assigned or reassigned to an event, when the assignment is successfully
completed, then I receive a notification informing me that I am responsible for the event.

*AC2 - Clarification request.* Given I am the Event Organiser of a request, when an Event Coordinator successfully
requests clarification from me, then I receive a notification informing me that additional information is required.

*AC3 - Clarification response.* Given I am the Event Coordinator responsible for a request, when the Event Organiser
successfully responds to a clarification request, then I receive a notification informing me that a response has been
provided.

*AC4 - Approval outcome.* Given I am the Event Organiser, when my event request is successfully approved, then I receive
a notification informing me that the request has been approved.

*AC5 - Rejection outcome.* Given I am the Event Organiser, when my event request is successfully rejected, then I receive
a notification informing me that the request has been rejected.

*AC6 - Mention notification.* Given another authorised user mentions me in a comment or reply, when the comment or reply
is successfully submitted, then I receive a notification informing me that I was mentioned.

*AC7 - Reply notification.* Given another authorised user replies directly to a comment I posted, when the reply is
successfully submitted, then I receive a notification informing me that my comment received a reply.

*AC8 - Relevant recipient only.* Given an activity generates a notification, when the notification is created, then it
is sent only to users who are relevant to that activity.

*AC9 - Avoid duplicate notifications.* Given a single activity qualifies me for more than one notification reason, when
the notification is generated, then I receive only one notification for that activity.

*AC10 - Successful actions only.* Given an action is cancelled, fails, or is not successfully completed, when no valid
business event occurs, then no notification is generated for that action.

*AC11 - Notification context.* Given I receive a notification, when I view it, then the notification contains enough
information for me to understand what happened, which event or request it relates to, and whether I need to take action.

*AC12 - Safety decision (proposed, to be added to SCRUM-47 in Jira).* Given I am the Event Coordinator or Event
Organiser of an event, when a Safety Officer successfully records a safety decision on it, then I receive a notification
informing me of the decision (Safety Approved, Safety Rejected or Changes Requested), including the reason or the
requested changes where given.

### Tests

Database tests are in `services/event-service/tests/integration/receiveNotifications.test.ts`.

| ID | Scenario |
| --- | --- |
| 47-S1 | A Lead's assignment, and a reassignment, each give the new coordinator one `coordinator_assigned` notification for the event (AC1). |
| 47-S2 | The assigned coordinator's clarification request gives the organiser one `clarification_requested`; another coordinator is refused (42501); the route passes the flag, GET comments returns it and `can_request_clarification`; the box is offered only to the assigned coordinator (AC2). |
| 47-S3 | The organiser's reply to it gives the assigned coordinator one `clarification_answered`; another coordinator's reply is a `comment_reply`; the request is labelled "Clarification requested" (AC3). |
| 47-S4 | The assigned coordinator approving gives the organiser one `event_approved` notification (AC4). |
| 47-S5 | Rejecting gives the organiser one `event_rejected` notification (AC5). |
| 47-S6 | Mentioning someone in a comment through `post_event_comment()` gives them one `comment_mention` notification (AC6). |
| 47-S7 | Replying to a comment gives its author one `comment_reply` notification (AC7). |
| 47-S8 | Replying to your own comment, or mentioning yourself, notifies nobody (AC8). |
| 47-S9 | A reply that also mentions the parent comment's author gives them one `comment_mention`, not two; a clarification request that also mentions the organiser gives one `clarification_requested`; the route posts a comment and its mentions with one `post_event_comment` call (AC9). |
| 47-S10 | Approving an already approved event notifies nobody; a comment the database refuses is answered 403 with no attachment saved (AC10). |
| 47-S11 | A rejection's message names the event and gives the reason; `notificationRequiresAction` by type; the service returns `actionRequired`; the page shows "Action needed" only where it is true; the header bell shows the unread count, opens the list, marks a chosen one read and opens it, says when the list is empty or can't load, links to the full page and closes on Escape or an outside click; the dashboard and every page header have it (AC11). |
| 47-S12 | A Safety Approved decision notifies the coordinator and the organiser; Changes Requested carries the requested changes and needs action (AC12). |

---

## SCRUM-172 Notify on the remaining event, venue and registration changes

**User story.** As a user involved in an event, I want an in-app notification when something I depend on changes, so that I can
act on it without checking each page.

Out of scope: email and SMS, the "venue block lifted" notice (no way to lift a block exists yet), Mark all as read (SCRUM-144),
and the cancel route with its required reason.

### Acceptance criteria

*AC1.* Given an organiser submits an event request, when it is saved, then every active Event Coordinator Lead is notified.

*AC2.* Given Venue Staff approve or reject a venue booking, when the decision is saved, then the event's assigned coordinator is
notified, with the reason on a rejection.

*AC3.* Given an important event change is saved, when it commits, then the organiser and the assigned coordinator are notified,
except whoever made the change.

*AC4.* Given a registration's status changes, when it commits, then that attendee is notified.

*AC5.* Given an event becomes Confirmed, when it commits, then the organiser and the assigned coordinator are notified.

*AC6.* Given an event becomes Cancelled, when it commits, then the organiser, the assigned coordinator and attendees who pass
`receivesEventUpdates()` are notified, with the reason when one was given (W9 r19).

*AC7.* Given a venue's buffer change creates a conflict, when it commits, then the assigned coordinator of each flagged booking is
notified (W9 r47).

*AC8.* Given a replacement venue is approved, when it commits, then the organiser and attendees who pass `receivesEventUpdates()`
are notified (W9 r52).

*AC9.* Given an attendee has withdrawn, when any of the above happens to the event, then that attendee gets no notification.

### Tests

Database tests are in `services/event-service/tests/integration/notificationProducers.test.ts` and
`services/venue-service/tests/integration/notificationProducers.test.ts`; the types and the attendee's link are in
`packages/shared/tests/notifications.test.ts`.

| ID | Scenario |
| --- | --- |
| 172-S1 | Submitting notifies an active Lead once and not an inactive one; resubmitting a returned request notifies; moving an event back during review does not (AC1). |
| 172-S2 | Approving notifies the coordinator and opens the booking; rejecting carries the reason; a hold becoming approved is not a decision (AC2). |
| 172-S3 | An important change notifies the organiser, naming the field, and not the coordinator who made it; every label equals `EVENT_FIELD_LABELS`; an ordinary or refused change notifies nobody (AC3). |
| 172-S4 | A status change notifies the attendee in their words; their own withdrawal, or the same status again, notifies nobody; an attendee's event notification opens `/registrations` (AC4). |
| 172-S5 | Becoming Confirmed notifies the organiser and coordinator; the coordinator who confirms is not told; a history row that is not the event's status notifies nobody (AC5). |
| 172-S6 | Becoming Cancelled notifies the organiser and coordinator with the reason; cancelling a cancelled event notifies nobody (AC6). |
| 172-S7 | A buffer change notifies the coordinator of each flagged booking, once per booking; the same times again, or no conflict, notifies nobody (AC7). |
| 172-S8 | An approved replacement notifies the organiser, naming the new venue, and a registered attendee; the coordinator hears through AC2; an ordinary amendment announces nothing (AC8). |
| 172-S9 | A cancellation reaches exactly the attendees `receivesEventUpdates()` allows, for all four statuses; a replacement skips a withdrawn attendee; a change to a withdrawn registration notifies nobody (AC9). |
