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
