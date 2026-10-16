# Notifications: View and Manage

User story for **View and Manage Notifications** (ConnectSphere, IS212), compiled 2026-10-15.

- Scenario numbers are the test IDs: `46-S3` means SCRUM-46, Scenario 3 (here scenario n is AC n).
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-46 | [Notification System] View and Manage Notifications | `notifications` table (migration 01) |

Out of scope: SCRUM-47 (the other triggers: assignment, clarification, approval, mentions) and email/SMS delivery. This
story builds the part every trigger needs: the table that only lets people read and mark their own rows, and the list.

## Implementation decisions (2026-10-15)

These override the text below where they conflict.

- **Endpoints** (`notification-service`, port 4005; need a session, 401 otherwise; every role may use them, because every
  user has notifications) **[DECIDED]**:

  | Method + path | Response |
  | --- | --- |
  | `GET /notifications?limit=` | 200 `{ items: NotificationItem[], unreadCount }`, newest first; `limit` defaults to 50, at most 100 |
  | `GET /notifications/unread-count` | 200 `{ unreadCount }` |
  | `POST /notifications/:id/read` | 200 `NotificationItem` (read). Idempotent: reading a read row changes nothing. 422 for an id that is not a uuid, 404 when the row is not the caller's or does not exist |

- **Own rows only is enforced by the database, not the service.** Migration `35_notifications_own_rows.sql` drops the
  blanket policy `notifications_authenticated_all` (02_rls.sql) and replaces it with SELECT and UPDATE policies on
  `user_id = auth.uid()`. The service queries as the caller (publishable key + their token), so a bug in it still cannot
  show someone else's row. **[DECIDED]**
- **Write privileges.** `insert`, `update` and `delete` are revoked from `authenticated` and `anon`, then `update
  (is_read)` alone is granted back. The UPDATE policy has `with check (user_id = auth.uid() and is_read)`, so a
  notification can be marked read but never un-read, and its title, message or owner cannot be rewritten. A BEFORE UPDATE
  trigger sets `read_at = now()` the first time `is_read` becomes true. **[DECIDED]**
- **Who writes rows.** Only producers running with the service role, or `security definer` SQL such as a trigger on the
  domain table. Nothing in the repo writes notifications today except `supabase/seed.sql` (service role). **[DECIDED]**
- **Typed link.** `notifications` gains `venue_booking_id uuid references venue_bookings(id) on delete cascade`
  (nullable) next to the existing `event_id`. A typed foreign key rather than a free-text URL, so a link cannot point
  anywhere the producer did not mean, and it disappears with its target. **[DECIDED]**
- **Types.** The four seeded types (`event_submitted`, `coordinator_assigned`, `event_confirmed`, `registration_opened`)
  plus `venue_booking_flagged`, which SCRUM-106 will write. The column stays free text; `NOTIFICATION_TYPES` in
  `packages/shared` lists the known ones. **[DECIDED]**
- **Related item and link (AC2, AC5, AC7).** A row with `venue_booking_id` relates to that booking; otherwise a row with
  `event_id` relates to that event; otherwise there is none. The service looks the target up **as the caller**, so row
  level security decides whether they can still see it. If it can be seen, the item carries `related: { kind, id, label,
  href }` with the event's name (or "Venue name for Event name" for a booking) and the page to open
  (`/events/:id`; `/venue-bookings/:id`, or `/booking-queue/:id` for venue staff, who have no coordinator view). If it
  cannot be seen, `href` is `null` and `label` is "You no longer have access to this item", and no name leaks. **[DECIDED]**
- **Web.** Page `/notifications` lists the rows. An unread row has a visible "Unread" text label and a highlighted style
  (colour alone is not enough). Clicking a row marks it read, then goes to its `href`; a "Mark as read" button marks it
  without leaving. A row with no `href` shows the no-access text and does not navigate. Every role's dashboard shows a
  "Notifications (n unread)" link; if notification-service is down the link shows without a count. **[DECIDED]**
- **Not built here [PROPOSED]:** "mark all as read", deleting, paging beyond the newest 100, real-time push.

---

## SCRUM-46 View and Manage Notifications

**User story.** As a user, I want to view and manage notifications that are relevant to me, so that I can quickly
understand important updates and identify actions that may require my attention.

### Acceptance criteria

*AC1 - View notifications.* Given I am logged in, when I open the notification area, then I can see notifications that
are intended for me.

*AC2 - Display notification details.* Given I have received a notification, when it is displayed, then I can see a clear
description of the activity, the related event or request where applicable, the date and time it was generated, and
whether it has been read or unread.

*AC3 - Distinguish unread notifications.* Given I have both read and unread notifications, when I view my notifications,
then unread notifications are visually distinguishable from read ones.

*AC4 - Mark notification as read.* Given I have an unread notification, when I open it or explicitly mark it as read,
then its status changes to Read.

*AC5 - Navigate from a notification.* Given a notification relates to an event or request that I am authorised to access,
when I select it, then I am taken to the relevant event, request or activity.

*AC6 - Access control.* Given I am logged in, when I view my notification list, then I only see notifications intended
for me.

*AC7 - Restricted destination.* Given I receive a notification but I no longer have permission to access the related
event or request, when I attempt to open it, then I am prevented from accessing the restricted information.

### Tests

| ID | Scenario |
| --- | --- |
| 46-S1 | The list returns the caller's notifications, newest first, with `unreadCount`; `limit` defaults to 50 and is capped at 100; the page and the dashboard link are reachable by every role; 401 without a session (AC1). |
| 46-S2 | Each item carries title, message, `createdAt`, `isRead`, `readAt`, the related item's label and the type (AC2). |
| 46-S3 | An unread row has the unread style and the visible "Unread" label; a read row has neither (AC3). |
| 46-S4 | `POST /notifications/:id/read` marks it read and sets `read_at` (the database trigger); a second call changes nothing; clicking a row or "Mark as read" calls it; 422 for a bad id; the unread count drops; the database refuses an un-read (AC4). |
| 46-S5 | An event maps to `/events/:id`, a booking to `/venue-bookings/:id` (`/booking-queue/:id` for venue staff); clicking a row marks it read and then navigates (AC5). |
| 46-S6 | The service returns only the caller's rows (query scoped to them); marking someone else's row is 404; in the database a coordinator can neither select nor update an organiser's row, and insert, delete and a title update are refused by the grants (AC6). |
| 46-S7 | A target the caller can no longer see (for example a reassigned coordinator and a venue booking) gets `href: null` and "You no longer have access to this item"; the row does not navigate (AC7). |
| DB | `read_at` set by the trigger once; `with check` refuses setting `is_read` back to false; the booking link is removed with the booking (cascade). |
