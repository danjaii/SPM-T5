# ADR 0003: Row-level security is the authorisation model

**Status**: Proposed
**Date**: 2026-10-28
**Sprint**: 3 (builds on SCRUM-91; remaining work in SCRUM-154, SCRUM-155, SCRUM-153 and SCRUM-156)

## Context

ConnectSphere has seven roles and five services that share one Postgres database (ADR 0001). The customer asks for
access that follows **role and relationship** (Week 1 non-functional requirement; Week 4 feature 1, Authorisation and
authentication): an organiser sees their own events, a coordinator the events they manage, an attendee their own
registrations, and so on. The customer does not say how to enforce it, but the Week 9 answers state the rule: "access control is based strictly on the
user's role and direct relationship to an event" (W9 r15; `REQUIREMENTS_STATUS.md` explains the `r<n>` references). This
ADR records how we do it.

ADR 0001 chose row-level security (RLS) over an authorisation service, and `CLAUDE.md` states the rule, but the reasoning
and the state of the work were never written down. As of 2026-10-28 the policies are per-role on `events` and its history
tables, `venue_bookings`, review tables, `event_registrations`, `notifications`, `venue_unavailability`,
`technical_staff_assignments`, `safety_checks` and `venue_booking_flags`. They are still the blanket "any signed-in user,
any row" policy from `02_rls.sql` on `users`, `organisations`, the lookup tables, `venues` and its link tables, `equipment`,
`technical_support_requests` and `activity_log`; `equipment_reservations` is open for read and delete. Of these, only
`users` (everyone can read everyone's email and phone) and `equipment_reservations` are a gap against what the customer
asked for; the others are write access to catalogue data.

## Decision

- **Authorisation is enforced by RLS in the database.** A request reaches Postgres as the caller (their Supabase JWT), and
  policies decide which rows they can read and change. Services decode the JWT to identify the caller (authentication)
  and do not repeat role checks the database already makes.
- **Services use the user-scoped client by default.** The service-role key bypasses RLS and is used only where bypassing
  is the intent: writing a notification row (ADR 0002), creating an auth user, or a `security definer` function that
  checks the caller itself.
- **Each table gets a policy per action, and no DELETE policy means no delete.** The migration's header holds the
  role-by-action matrix. `07_venue_bookings_rls.sql` is the pattern; new policies reuse its `security definer` helpers
  (`current_user_role()`, `is_assigned_coordinator()`, `is_event_organiser()`, `user_can_access_event()`) so a policy never
  subqueries `events` inline.
- **Column limits use column grants, not policies,** because a policy cannot say which column changed (migration 03 for
  `users.role`, migration 26 for `venues`).
- **When a role may see part of a row, a `security definer` function returns that part.** Examples: a person's display name
  for an assignee list, an attendee's contact details for the event's own organiser and coordinator. The table stays closed
  and the function checks the caller.
- **Coordinators read only the events assigned to them (built in SCRUM-156).** SCRUM-91 let every coordinator read every non-draft event,
  matching `GET /events/:id` and the review queue, and an earlier draft of this ADR kept that. The customer's Week 9
  answers changed it: access is "strictly on the user's role and direct relationship to an event" (W9 r15), coordinators
  "only manage events assigned to them by the Lead" (W9 r36), and the unassigned queue belongs to Leads (W9 r61). A
  coordinator therefore has no reason to read an unassigned event or another coordinator's. This is a fourth story,
  after the other three, and needs an audit of every page and route that assumes the wide read (review queue,
  `GET /events/:id`, comments, `events_update_coordinator`). Leads, who see all events system-wide (W9 r37), get their own
  read policy.
- **Scope of the remaining work.** Four stories, in this order: `users` (own row, names through a function; SCRUM-154),
  catalogue writes limited to the owning role (SCRUM-155), equipment reservations and technical support requests
  following the event's access (SCRUM-153), then coordinator reads limited to assigned events (SCRUM-156). For the
  catalogue story the owning role is Venue
  Staff for `venues`, its link tables and `room_layouts` (the customer says Venue Staff define layout types and can add,
  edit and delete them, W9 r14), Technical Support Staff for `equipment` (W9 r12), and nobody through the API for
  `organisations` and `event_categories`. `facilities` is treated like `room_layouts` until the customer says otherwise.
  Not planned, because no customer requirement rests on them: narrowing reads of the reference data (lookup tables,
  venues, equipment are readable by everyone signed in) and `activity_log`.

## Alternatives considered

- **A separate authorisation service or middleware in each service.** Rejected: five services would each re-implement the
  rules and drift apart, and a direct query to Supabase would skip them all. RLS applies to every path in.
- **Checks only in application code (the original SCRUM-23/AC4 approach).** Rejected: the browser and tests can reach the
  database with a user's token, so a check in a service is not a boundary.
- **Keep coordinators reading every non-draft event (SCRUM-91's choice).** Rejected after the Week 9 answers, for the
  reason under Decision; it is deferred to the last story only because it touches the most code.
- **Replace every blanket policy in one story.** Rejected: one story per branch, and the reference tables have no customer
  requirement behind them.

## Consequences

- A table with a blanket policy is a known gap, not a design. `CLAUDE.md` points here for the list.
- Every RLS change must be checked against the services that read the table; a service holding the service-role key hides
  a bad policy until a user-scoped client meets it. Integration tests must run as each role.
- Names and contact details of other users stop being readable through the table once `users` is closed. Pages that show a
  name must go through the lookup function.
- A coordinator reads an event, and its comments, mentions, attachments and history, only while it is assigned to them
  (SCRUM-156, migration 59, spec `docs/specs/coordinator-event-reads.md`). A reassigned event moves with the coordinator:
  the previous one keeps nothing. `user_can_access_event()` is the one definition of who may read an event's review data.
- A Lead is not yet the system-wide reader the Week 9 answers describe (W9 r37). The database lets a Lead read unassigned
  submitted events (migration 21) and the events of their own linked coordinators (migration 22), and no comments or
  history. That is a known gap against r37, left for a later story.
- Venue create and edit (SCRUM-57, SCRUM-58) depend on the catalogue-write story (SCRUM-155) for their write policy.
