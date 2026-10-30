# Current state: what is built, and which story built it

Moved here from `CLAUDE.md` so that file only holds the rules every session needs. The text below is the old
"Current state" section word for word (only paragraph breaks were added, one per service). It is written in the order
the stories were built, not grouped by service.

**Keeping it current.** When a story changes what exists (a route, a migration, a trigger, a rule), add a sentence here with
the story, its spec in `docs/specs/` and the migration number. Update the service's C4 diagram in `docs/architecture/c4/`
as `CLAUDE.md`'s Conventions say. Do not add it to `CLAUDE.md`.

Parts of the repo are still scaffolding — `notification-service` is the read side of in-app notifications only (SCRUM-46,
below); no email or SMS is sent yet, and the `healthCheck()` exports in
`services/*/src/index.ts` are leftovers from the original scaffold.

`venue-service` is built out for the venue catalogue (SCRUM-29) and venue booking requests
(SCRUM-36, 32, 33, 35, 60, 59; spec in `docs/specs/venue-booking-request.md`, diagram in
`component-venue-service.puml`), and for the Venue Staff queue, approve and reject (SCRUM-37 to 39;
spec in `docs/specs/venue-booking-approval.md`). An event can hold several venue bookings (SCRUM-98; spec in `docs/specs/multiple-venue-bookings.md`, migration 28):
the one-per-event rule (DR6) is gone, the same venue for an overlapping period on one event is `DUPLICATE_VENUE`, a rejected
request has at most one active replacement (`ACTIVE_REQUEST_EXISTS`), each booking can have its own expected attendance and
venue requirements, more people than the venue holds is flagged (`exceedsCapacity`) rather than refused, and
`GET /events/:id/venue-bookings` lists an event's bookings for its page. One of them can be changed (`PATCH
/venue-bookings/:id`) or cancelled with a reason (`POST /venue-bookings/:id/cancel`) without touching the others (SCRUM-102;
spec in `docs/specs/change-cancel-venue-booking.md`), through the security definer functions `change_venue_booking()` and
`cancel_venue_booking()` (migration 30), only by the event's current coordinator and only before the event is Confirmed. A
change sends it back to PENDING and moves its equipment requests to the new time, back to Submitted; cancelling releases its
equipment requests (`cancelled`, shown as Released). Venue search (SCRUM-65; spec in `docs/specs/venue-search.md`) adds `GET /venues/search` backed by the
`available_venues` database function (`18_venue_search.sql`). Each venue has a setup and a turnaround time in whole minutes (SCRUM-101; spec in `docs/specs/venue-setup-turnaround.md`, migration 26): Venue Staff edit them on the venue detail page through `PUT /venues/:id/timing`, coordinators only read them, and they pad every booking (SCRUM-103; spec in `docs/specs/venue-padded-occupancy.md`, migration 27): a request, amendment or change is refused when its setup and turnaround overlap another booking's, the refusal names the occupied period, and `GET /venues/:id/availability` shows setup and turnaround apart from the event. Raising a venue's times flags the existing bookings that now clash (SCRUM-104; spec in `docs/specs/venue-buffer-conflicts.md`, migration 36): `set_venue_timing()` writes `venue_booking_flags` rows in the same transaction and `PUT /venues/:id/timing` lists the pairs, a flagged booking keeps its status but shows "Buffer conflict" to its coordinator and cannot be approved (`BOOKING_FLAGGED`, trigger code `CS104`; reject still works). Venue Staff can mark a venue temporarily unavailable (SCRUM-105; spec in `docs/specs/venue-unavailability.md`, migrations 38 and 39): only the `mark_venue_unavailable()` function writes `venue_unavailability`, a new request whose padded period touches a block is refused with `VENUE_UNAVAILABLE` (SQLSTATE `CS105`). The holding, future bookings already inside a new block are flagged "Venue unavailable – alternative needed" (SCRUM-106; spec in `docs/specs/venue-unavailability-flags.md`, migration 46): a trigger on `venue_unavailability` writes the `venue_booking_flags` rows inside `mark_venue_unavailable()` (which now returns the block id and `flagged_count`, and `POST /venues/:id/unavailability` adds `affectedBookings`), a second trigger writes one `venue_booking_flagged` notification for the event's assigned coordinator in the same transaction (ADR 0002), the booking and its event are untouched, and SCRUM-104's guard already stops a flagged Pending request being approved (reject still works). The assigned coordinator can then request a replacement venue for such a booking (SCRUM-107; spec in `docs/specs/replacement-venue.md`, migrations 47 and 48): `GET /venue-bookings/:id/replacement-candidates` lists the free venues big enough and `POST /venue-bookings/:id/replacement` creates a PENDING request linked to the original (even on a Confirmed event), and when Venue Staff approve it the `venue_booking_take_over()` trigger makes the original `replaced`, resolves its flag as `replaced` and moves its equipment requests to the replacement, back to Submitted. A venue can be checked against an event (SCRUM-109; spec in `docs/specs/venue-suitability.md`): `GET /venue-suitability` runs the shared `checkSuitability` (capacity, layout, operating hours and availability are judged; facilities and accessibility text are not checked yet). SCRUM-40 (suggested alternative) is not built: the
`Decision` type and `suggested_*` columns are its seam.

`equipment-service` is built out for the
availability check (SCRUM-18; spec in `docs/specs/equipment-availability.md`; SCRUM-137 shares its counting rule,
`unitsFree()`, with a waiting request's "Available 4 / need 6" and the `GET /equipment-inventory` Inventory page, which name
the events holding units and any out-of-service reason; damage is per catalogue item, not per unit) and for reserving equipment
for an event (SCRUM-19; spec in `docs/specs/equipment-reservation.md`, saved atomically by the
`reserve_equipment()` function in migration 12; diagram in `component-equipment-service.puml`). An Event
Coordinator can also request equipment for their event (SCRUM-86; spec in `docs/specs/equipment-requests.md`): a
request is a `requested` row in `equipment_reservations`, for a catalogue item and one of the event's approved venue
bookings (`venue_booking_id`, migration 25), and migration 25's restrictive insert policy lets only the assigned
coordinator of an open event add one. The spec's open-question rules live in `packages/shared/src/equipmentRequest.ts`.
Technical Support Staff review requests (SCRUM-87; same spec): a queue at `/equipment-requests`, and a status change
through `review_equipment_request()` (migration 32), which refuses Arranged when too few units are free. The
assigned Event Coordinator can change a request (SCRUM-88; same spec): `update_equipment_request()` (migration 45) saves
the change and sends it back to Submitted, where Technical Support Staff see it marked Updated; AC7 (a new safety check)
when equipment changes after approval) can now build on SCRUM-99 and follows in its own change, and AC9 is not built. The event's coordinator assigns Technical Support Staff on-site (SCRUM-20; spec in
`docs/specs/technical-assignment-notifications.md`, migration 41): `technical_staff_assignments` rows for one of the event's
approved venue bookings, written only by `assign_technical_staff()`, `change_technical_assignment()` and
`cancel_technical_assignment()` (equipment-service `routes/technicalAssignments.ts`); a trigger writes the technician's
"assigned", "changed" and "cancelled" notifications in the same transaction (ADR 0002), and the technician acknowledges one
through notification-service (`POST /notifications/:id/acknowledge`, `acknowledge_technical_assignment()`), which marks the
assignment acknowledged until its venue booking or times change again. The
equipment catalogue and request notes (SCRUM-87/AC8) are not built yet.


`event-service` also lets an organiser submit an event change request (SCRUM-66; spec in
`docs/specs/event-change-request.md`, `routes/changeRequests.ts`, migration `15_event_change_requests_insert.sql`);
the event's assigned coordinator reviews it (SCRUM-67; spec in `docs/specs/review-change-request.md`,
`routes/changeRequestReview.ts`, migration 42): `GET /change-requests/:id` shows each requested change with the current value
(`readChangeRequest()` in `packages/shared/src/changeRequestReview.ts`), and `review_change_request()` either rejects it with a
required reason or approves it through `update_event_details()` in the same transaction, so an approval is recorded in the
change history and sends the affected arrangements back for review (SCRUM-112/113). A request the event has moved on from, or
one with a field the system cannot apply, can only be rejected. The assigned coordinator edits an event's details
(SCRUM-111; spec in `docs/specs/edit-event-details.md`, `routes/eventDetails.ts`, migration 34): ordinary fields (name, description,
purpose, category) and important ones (dates and times, attendance, layout, accessibility, venue and equipment requirements; the
lists are in `packages/shared/src/eventDetails.ts`), not for a completed, cancelled or rejected event. `update_event_details()` saves
the edit and a row in `event_change_history` together, which the event's coordinator and organiser can read. Migration 34 also adds
`events.venue_requirements`. Before an important change is saved, the coordinator sees which venue bookings and equipment
requests it may affect, and why (SCRUM-112; spec in `docs/specs/important-change-impact.md`, `affectedArrangements()` in
`packages/shared/src/eventImpact.ts`): `PATCH /events/:id` answers 409 `CONFIRM_IMPACT` with the list, and saves only when sent
again with `confirmImpact: true` (Save anyway). A raised attendance lists every active venue booking, all treated alike, and
Save anyway sends the listed ones back for review (SCRUM-113; spec in
`docs/specs/send-back-affected-arrangements.md`, migration 40): `update_event_details()` gains `p_send_back` and, in the same
step, returns those venue bookings to Pending (still holding their venue) and equipment requests to Submitted (units
released), stores what changed on each (`sent_back_changes`, `sent_back_at`, shown by `sentBackNote()` in
`packages/shared/src/sentBack.ts` on the Venue Staff queue and the Technical Support Staff review page), and returns a
Confirmed event to Planning when anything was sent back. A trigger clears the note on the next status change that is not
a send-back, so approving, rejecting, reviewing, changing or cancelling needs no change of its own.

`auth-service` also serves a user's own profile
(SCRUM-68: `GET` and `PATCH /profile`; spec in `docs/specs/user-profile.md`): the profile email is a contact email,
separate from the Supabase Auth login email, and only name, contact email, phone and communication preferences
can be changed. Staff (internal users) also see their department and responsibilities
(SCRUM-69): the department is on their `users` row, and the responsibilities are stored once for each role in the
`role_responsibilities` table (migration 17). The attendee's List of events can be searched live (SCRUM-9; spec in `docs/specs/event-search.md`): the browser filters the cards as
the attendee types, using the organisation, category and coordinator names that `list_public_events()` now returns (migration 20). The
shared role list now has seven roles: the Event Coordinator Lead and the Safety Officer (week 7 customer
changes) exist as roles (migration 16). The Lead is being built out (spec in `docs/specs/event-coordinator-lead-role.md`):
it has a sign-in option, a home page and seeded accounts, and each Event Coordinator can be linked to the one Lead who
supervises them (`users.supervising_lead_id`, migration 19; SCRUM-75). Leads share one unassigned queue (SCRUM-77,
`lead_unassigned_queue()` in migration 21). A closed event is completed, cancelled or rejected: `CLOSED_EVENT_STATUSES` in
`packages/shared` and `is_closed_event_status()` in migration 21, kept equal by a test. A Lead sees their active
coordinators' workload and non-closed events (SCRUM-81, migration 22). Only a Lead assigns (SCRUM-78, migration 23) or
reassigns (SCRUM-79, migration 24) an event's coordinator, and only to their own active coordinators; the
`events_assignment_guard` trigger enforces it for every caller. This replaced SCRUM-42's coordinator self-claim and
SCRUM-41's hand-over: the coordinators' `/events/:id/assign-coordinator` and `/eligible-coordinators` routes now only
refuse. A Safety Officer runs the Operational Safety Check (SCRUM-99; spec in `docs/specs/operational-safety-check.md`,
`routes/safetyChecks.ts`, migration 37): `/safety-checks` lists the events ready for a check (awaiting arrangements, every
active venue booking approved, every equipment request arranged, no decision yet), `/safety-checks/[id]` shows the safety
information (migration 37 adds `venues.emergency_access` and `venues.restrictions`) and records Approve, Reject (reason
required) or Request Changes (comment required) in `safety_checks`. The `events_safety_gate` trigger stops anyone, the
service role included, moving an event to confirmed until its latest decision is approved. Request Changes (SCRUM-100,
migration 43) moves the event back to planning; once the coordinator returns it to awaiting arrangements with its
arrangements complete, it is back in the queue for another check. The event's coordinator and organiser see every
safety decision on the event page (`GET /events/:id/safety-decisions`, `event_safety_decisions()`). An important change to an
approved event revokes the approval (`safety_checks.revoked_at`, migration 43's trigger), so it needs another check; a
confirmed event goes back to awaiting arrangements. Organisers and coordinators see the registrations of the events they manage on `/registrations-overview`
(SCRUM-74): `GET /events/managed` lists an organiser's own or a coordinator's assigned events, and the page shows the chosen
event's registrations newest first, with a summary in which only Confirmed registrations use a slot.

Users can view and manage their own in-app notifications (SCRUM-46; spec in `docs/specs/notifications.md`, ADR 0002):
`notification-service` serves `GET /notifications`, `GET /notifications/unread-count` and `POST /notifications/:id/read`,
`notifications` is own-rows RLS (migration 35), the page is `/notifications`, and the bell in every signed-in page's header (`AppHeader`, `NotificationBell`) shows the unread count and a dropdown of them that links to it. SCRUM-47 (spec in
`docs/specs/receive-notifications.md`, migration 44) adds the producers, triggers that write each row in the same transaction as
its change: a coordinator's assignment, an event request's approval or rejection, a comment mention or reply (one per person,
never the author; comments are saved through `post_event_comment()`), a clarification request and the organiser's answer (a
comment the assigned coordinator flags, `event_comments.is_clarification_request`), and a safety decision. Each item carries
`actionRequired` (`notificationRequiresAction()` in `packages/shared`).
