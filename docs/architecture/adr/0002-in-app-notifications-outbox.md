# ADR 0002: In-app notifications are rows written with the change they announce

**Status**: Accepted
**Date**: 2026-10-15
**Sprint**: 3 (SCRUM-46; producers in SCRUM-47 and SCRUM-106)

## Context

Users need to see, in the app, what happened that concerns them (SCRUM-46), and later services must be able to raise
those notifications: an assignment, a clarification, an approval, a venue booking flagged because the venue became
unavailable (SCRUM-47, SCRUM-106). Two things pull against each other:

- A notification must exist **if and only if** the change it announces happened. A notice for a change that was rolled
  back is wrong, and a change with no notice is silently missed.
- Services are separate processes that share one database (ADR 0001), and `notification-service` is the one that shows
  notifications. Making every other service call it over HTTP couples them to it being up.

The `notifications` table was also open to every signed-in user (a blanket policy from `02_rls.sql`), so anyone could read
or rewrite anyone's notifications.

## Decision

- **Producers write the notification row inside the same database transaction as the domain change**, through
  `security definer` SQL (a trigger or a function such as the one that flags a booking) or the service role. This is the
  transactional outbox pattern: the `notifications` table is the outbox. If the change rolls back, so does the row.
- **`notification-service` is the read and mark-read side only.** It lists a user's notifications, counts the unread ones
  and marks one read, always as the caller (publishable key and their token), never with the service-role key.
- **Row level security makes it safe.** Migration 35 lets a signed-in user select and update only their own rows, and only
  the `is_read` column, only to true. Nobody but producers can insert. So a bug in the service cannot expose another
  user's notification.
- **A notification links to a typed target** (`event_id`, `venue_booking_id`), not a URL. At read time the service checks,
  under the reader's own RLS, whether they can still see the target; if not, the link is withheld.
- **Email and SMS come later, by webhook, not polling.** A database webhook (Supabase) on `notifications` inserts will
  call the dispatch component, which sends the message. Nothing polls the table.

## Alternatives considered

- **Producers call notification-service over HTTP.** Rejected: the call can be lost, or succeed for a change that then
  rolls back, so notifications and changes drift apart; it also makes every producer depend on notification-service being up.
- **A message queue between services.** Rejected for now: it solves the same problem with another moving part to run,
  while the shared database already gives a transaction. Revisit if services get separate databases.
- **notification-service polls the domain tables for changes.** Rejected: polling is exactly what CLAUDE.md says to avoid,
  and it cannot tell who should be told or why.
- **Keep the blanket policy and filter in the service.** Rejected: it leaves every user able to read or rewrite everyone's
  notifications through the API directly.

## Consequences

- Producers (SCRUM-47, SCRUM-106) must write the row in their own transaction and set the typed link; they are SQL work,
  not HTTP calls.
- The `notifications` table is closed for the per-role RLS stories (SCRUM-91, 92, 93).
- Producers choose the recipient in SQL (for example the event's assigned coordinator at that moment); the service shows
  only what it is given.
- Rows are never deleted by users; retention (archiving old rows) is not decided.
- Email/SMS dispatch needs a database webhook and a provider, which is a separate story.
