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
equipment requests (`cancelled`, shown as Released). Venue Staff add a venue (SCRUM-57; spec in `docs/specs/venue-add.md`, migration 73): `POST /venues` saves it through `create_venue()`, which writes the venue, its layouts and its facilities in one transaction (nobody can delete a venue, so a half-made one could not be cleaned up), `GET /venues/:id` says `can_manage_catalogue`, `/venues/new` is the form, and duplicate names are allowed. Venue Staff edit one (SCRUM-58; spec in `docs/specs/venue-edit.md`, migration 74): `PUT /venues/:id` saves it through `update_venue()` (same all-or-nothing save; setup and turnaround times are left to `set_venue_timing()`), `GET /venues/:id/edit` fills the form at `/venues/[id]/edit`, and a capacity cut that leaves a holding booking over capacity answers 409 `CONFIRM_IMPACT` with the bookings until sent again with `confirmImpact: true` (proposed; the customer has not answered). Venue Staff may suggest an alternative when they reject a request (SCRUM-40; spec in `docs/specs/venue-booking-suggestion.md`, no migration): `POST /venue-bookings/:id/reject` takes an optional `suggestion` { venueId, date, startTime, endTime } (all four or none, a real date and a future start, an active venue; checked by the shared `parseRejectionInput` and the decision service), stored with the rejection through the existing conditional update; it holds no slot, so another coordinator can still request that venue and period; the Reject dialog's optional "Suggest an alternative" fills it in, and the coordinator's request page shows it with the SCRUM-59 accept action. Venue Staff maintain the room layout types (SCRUM-181; spec in `docs/specs/layout-type-maintenance.md`, migration 79): `GET`, `POST`, `PATCH` and `DELETE /layout-types` (Venue Staff only, even for `GET`) call `create_layout_type()`, `rename_layout_type()` and `delete_layout_type()`, which trim and de-duplicate names ignoring case, log each change, and refuse a delete while a venue supports the type or an event request or draft prefers it (409 `LAYOUT_TYPE_IN_USE` naming the venues and counting the event requests); `/venues/layout-types` is the page, reached from a button on the catalogue and a link in the venue form. Venue search (SCRUM-65; spec in `docs/specs/venue-search.md`) adds `GET /venues/search` backed by the
`available_venues` database function (`18_venue_search.sql`). Each venue has a setup and a turnaround time in whole minutes (SCRUM-101; spec in `docs/specs/venue-setup-turnaround.md`, migration 26): Venue Staff edit them on the venue detail page through `PUT /venues/:id/timing`, coordinators only read them, and they pad every booking (SCRUM-103; spec in `docs/specs/venue-padded-occupancy.md`, migration 27): a request, amendment or change is refused when its setup and turnaround overlap another booking's, the refusal names the occupied period, and `GET /venues/:id/availability` shows setup and turnaround apart from the event. Raising a venue's times flags the existing bookings that now clash (SCRUM-104; spec in `docs/specs/venue-buffer-conflicts.md`, migration 36): `set_venue_timing()` writes `venue_booking_flags` rows in the same transaction and `PUT /venues/:id/timing` lists the pairs, a flagged booking keeps its status but shows "Buffer conflict" to its coordinator and cannot be approved (`BOOKING_FLAGGED`, trigger code `CS104`; reject still works). Venue Staff can mark a venue temporarily unavailable (SCRUM-105; spec in `docs/specs/venue-unavailability.md`, migrations 38 and 39): only the `mark_venue_unavailable()` function writes `venue_unavailability`, a new request whose padded period touches a block is refused with `VENUE_UNAVAILABLE` (SQLSTATE `CS105`). The holding, future bookings already inside a new block are flagged "Venue unavailable – alternative needed" (SCRUM-106; spec in `docs/specs/venue-unavailability-flags.md`, migration 46): a trigger on `venue_unavailability` writes the `venue_booking_flags` rows inside `mark_venue_unavailable()` (which now returns the block id and `flagged_count`, and `POST /venues/:id/unavailability` adds `affectedBookings`), a second trigger writes one `venue_booking_flagged` notification for the event's assigned coordinator in the same transaction (ADR 0002), the booking is untouched, an event that was Confirmed is returned to Planning in the same transaction (SCRUM-185/AC1; spec `docs/specs/venue-block-reverts-event.md`, migration 82: its Safety Approval is revoked, a status history row is written and its coordinator gets one `event_returned_to_planning` notification; events in any other status keep their status), and SCRUM-104's guard already stops a flagged Pending request being approved (reject still works). Venue Staff can lift a block (SCRUM-185/AC2; spec in `docs/specs/venue-block-lifting.md`, migration 80): `POST /venues/:id/unavailability/:blockId/lift` calls `lift_venue_unavailability()`, which removes the block and the flags it raised and writes one `venue_block_lifted` notification for the assigned coordinator of each still-open flagged booking, in one transaction; the venue page shows a Lift block button to Venue Staff only, after a confirmation. The assigned coordinator can then request a replacement venue for such a booking (SCRUM-107; spec in `docs/specs/replacement-venue.md`, migrations 47 and 48): `GET /venue-bookings/:id/replacement-candidates` lists the free venues big enough and `POST /venue-bookings/:id/replacement` creates a PENDING request linked to the original (even on a Confirmed event), and when Venue Staff approve it the `venue_booking_take_over()` trigger makes the original `replaced`, resolves its flag as `replaced` and moves its equipment requests to the replacement, back to Submitted. A venue can be checked against an event (SCRUM-109; spec in `docs/specs/venue-suitability.md`): `GET /venue-suitability` runs the shared `checkSuitability` (capacity, layout, operating hours and availability are judged; facilities and accessibility text are not checked yet). SCRUM-40 (suggested alternative) is not built: the
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
when equipment changes after approval) can now build on SCRUM-99 and follows in its own change, and AC9 is not built. Technical Support Staff maintain the equipment catalogue (SCRUM-182; spec in `docs/specs/equipment-catalogue-maintenance.md`, migration 78): `GET`, `POST` and `PUT /equipment-catalogue` (Technical Support Staff only, even for `GET`) call `create_equipment()` and `update_equipment()`, which trim the text, check each field, log what changed, and let an edit change the operational status (an edit must send one; a new item always starts available); a status other than available leaves the item with no free units in the inventory and the availability check, and `/equipment-catalogue` is the page, reached from a button on the Inventory page. The event's coordinator assigns Technical Support Staff on-site (SCRUM-20; spec in
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
one with a field the system cannot apply, can only be rejected. An organiser cannot send a request that changes what one of
their pending requests already changes (SCRUM-176; spec in `docs/specs/conflicting-change-request.md`, migration 67): the
shared `changeRequestConflicts()` counts start and end time as one thing, the route answers 409 `CONFLICTING_REQUEST` naming what
waits, a database trigger refuses the same insert (CS176), and the form says up front what is waiting. The assigned coordinator edits an event's details
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
it has a sign-in option, seeded accounts and, as its home page, the unassigned queue (SCRUM-188: `/dashboard/event_coordinator_lead` forwards to `/lead/queue`), and each Event Coordinator can be linked to the one Lead who
supervises them (`users.supervising_lead_id`, migration 19; SCRUM-75). That link no longer limits what a Lead sees or assigns: since SCRUM-184 (spec `docs/specs/lead-system-wide-scope.md`, migration 81) a Lead reads every submitted event (not drafts), sees every active coordinator with their workload, and assigns or reassigns any event to any active coordinator, with no workload limit (`is_coordinator()` replaced `is_my_coordinator()`). Leads share one unassigned queue (SCRUM-77,
`lead_unassigned_queue()` in migration 21). A closed event is completed, cancelled or rejected: `CLOSED_EVENT_STATUSES` in
`packages/shared` and `is_closed_event_status()` in migration 21, kept equal by a test. A Lead sees their active
coordinators' workload and non-closed events (SCRUM-81, migration 22), and every active event in one list filtered by coordinator, status and name (`GET /lead/events` and `/lead/events`, SCRUM-189; no migration, RLS from migration 81 decides the rows). Only a Lead assigns (SCRUM-78, migration 23) or
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
confirmed event goes back to awaiting arrangements. Reject now returns the event to planning as Request Changes does, and the
last venue booking or equipment request approved moves a planning event to awaiting arrangements by itself, so it enters the
queue with no manual step (SCRUM-171; same spec, migration 66, `event_arrangements_complete()`). When that event had been
returned to Planning by a venue block (the latest move to Planning was Confirmed to Planning made by Venue Staff), the same
move also tells its organiser and every attendee with an active registration, once, with an `arrangements_reconfirmed`
notification naming the current venue (SCRUM-185/AC3; spec `docs/specs/replacement-confirmed-notice.md`, migration 83).
The assigned coordinator cancels an event by setting it to Cancelled with a
required reason (SCRUM-174; spec in `docs/specs/cancel-event.md`, migrations 60 to 63): in the same transaction, triggers cancel its
active venue bookings, release its equipment requests and on-site technician assignments, close its pending change requests (as
`rejected`, also when the event is completed), and SCRUM-172's migration 65 notifies the organiser and every registered or waitlisted attendee
(`event_cancelled`); a cancelled event cannot change status again, and a completed or rejected one cannot be cancelled (CS174).
Guarded status transitions were considered and not built, because the customer said status progression is flexible; see
`docs/scope-decisions.md`. Organisers and coordinators see the registrations of the events they manage on `/registrations-overview`
(SCRUM-74): `GET /events/managed` lists an organiser's own or a coordinator's assigned events, and the page shows the chosen
event's registrations newest first, with a summary in which only Confirmed registrations use a slot. A registration is Confirmed
straight away while places remain and Pending once the event is full (SCRUM-169, migration 68): `register_for_event()` locks the event
row so two attendees can't both take the last place, and a full event still offers Register (`can_register`). On that page the event's
organiser confirms or declines each Pending one (`POST /events/:id/registrations/:registrationId/decision`, `decide_registration()`);
confirming on a full event is refused (`EVENT_FULL`, SQLSTATE `CS169`), and withdrawing frees a place without promoting anyone.
The event's assigned coordinator can adjust its registration capacity and window (SCRUM-185/AC4; spec `docs/specs/registration-settings-while-replanning.md`, migration 84): `GET` and `PUT /events/:id/registration-settings` call `update_registration_settings()`, which refuses a capacity below the Confirmed registrations and an event that is closed or takes no registrations, and logs each change; the Registrations tab shows the coordinator a form for it, and a note that registration is closed while the event is not Confirmed (which `register_for_event()` and `list_public_events()` already enforce, so an event a venue block returned to Planning takes no new registrations and keeps the existing ones).
The organiser can also add a VIP past the cap there, by the email of an attendee account (SCRUM-170, migration 69): `POST
/events/:id/vip-registrations` calls `add_vip_registration()`, which only the event's organiser can use and which refuses at the smallest
approved venue's capacity (`VENUE_FULL`, SQLSTATE `CS170`). A Pending attendee is confirmed on their own row, the VIP gets the usual status
notification, and `event_registrations.is_vip` shows a VIP label to the organiser and coordinator. A VIP uses a place like anyone else.

Users can view and manage their own in-app notifications (SCRUM-46; spec in `docs/specs/notifications.md`, ADR 0002):
`notification-service` serves `GET /notifications`, `GET /notifications/unread-count` and `POST /notifications/:id/read`,
`notifications` is own-rows RLS (migration 35), the page is `/notifications`, and the bell (`NotificationBell`, in the app shell's sidebar and in `AppHeader`, the top bar some pages still render) shows the unread count and a dropdown of them that links to it. SCRUM-47 (spec in
`docs/specs/receive-notifications.md`, migration 44) adds the producers, triggers that write each row in the same transaction as
its change: a coordinator's assignment, an event request's approval or rejection, a comment mention or reply (one per person,
never the author; comments are saved through `post_event_comment()`), a clarification request and the organiser's answer (a
comment the assigned coordinator flags, `event_comments.is_clarification_request`), and a safety decision. Each item carries
`actionRequired` (`notificationRequiresAction()` in `packages/shared`). SCRUM-172 (same spec, migration 65) adds the remaining
producers, also triggers: a submitted request tells every active Lead; a venue booking approved or rejected tells the assigned
coordinator; an important change tells the organiser and coordinator; a registration status change tells the attendee; a confirmed
event tells the organiser and coordinator; a cancelled one tells them and the attendees; a buffer conflict tells the coordinator of
each flagged booking; a replacement venue tells the organiser and attendees. Nobody is told about their own action, and a withdrawn
attendee hears nothing (`event_update_attendees()`, kept equal to `receivesEventUpdates()` by a test). An attendee's event
notification opens `/registrations`, because the event page refuses them.
SCRUM-97/tentative-hold-expiry
- Tentative hold expiry (SCRUM-97; spec `docs/specs/SCRUM-97-108-tentative-hold-expiry.md`, migration 87): `venue_bookings.hold_expires_at`; `set_hold_expiry()` (Venue Staff only) is the only way to write it; a lapsed hold is derived as EXPIRED, never holds its slot, and `approve` is refused for it (`HOLD_EXPIRED`); the event's coordinator is notified of each change. A conflict caused by a pending hold reads "tentatively held" (`slotConflictMessage()`).
<<<<<<< HEAD
- Hold expiry warnings (SCRUM-108, migration 88): `hold_warning_minutes` (default 24 h, set by the event's coordinator through `set_hold_warning()`), two sent flags, and `notify_hold_expiries(p_now)` (service role only), which `notification-service` calls every minute (`services/holdExpiryCheck.ts`, needs `SUPABASE_SECRET_KEY`); it writes one `hold_expiring` and one `hold_expired` notification per hold for the event's coordinator, and a changed expiry re-arms both.
=======
- Delete a draft (SCRUM-56; spec `docs/specs/SCRUM-56-delete-draft-event-request.md`, migration 85): `DELETE /events/drafts/:id` calls the security definer `delete_event_draft()` as the caller, which removes only the caller's own `draft` event; the Delete button on My event requests asks first.
- Venue calendar page (SCRUM-84 UI, `/venue-calendar`, no migration): reads `GET /venue-calendar` and shows each venue's periods as Tentatively Held, Confirmed, Blocked, Available or Unavailable, and the 422 messages; SCRUM-130 replaced its list with the day timeline below.
- Venue availability details (SCRUM-85, no migration): choosing a calendar period opens its details (a popover since SCRUM-130) with the venue's name, address and capacity, the period's status with its start and end, the whole free window, a block's reason, and the booking a setup or turnaround belongs to.
- Venue calendar day view (SCRUM-130, Figma 09, no migration): the page opens on today as a timeline with every venue a row and the hours across (08:00 to 20:00, widened for a booking outside them), a red line at the current time, bookings and holds at their time and length, setup and turnaround dashed either side, blocks striped with their reason on hover, tap and keyboard focus (red where they lie over a confirmed booking), closed time in grey, and a banner for each closure over confirmed bookings (with a link to Booking requests for Venue Staff). Week follows Figma 09a: venue rows by day columns, each day with an occupancy bar for 08:00 to 22:00, its bookings and single-day blocks as chips (or Available with its hours, or Closed), a block over several days as one banner, today tinted, and a details popover with Open day view. Month shows each day's busiest status. Day, Week and Month replace the SCRUM-84 date form and Reload; the legend sits at the right of the view controls; Mark venue unavailable is beside the title for Venue Staff, with a venue picker; an Event Coordinator gets New booking there instead, which lists their events that can take a venue request (`canRequestVenueBookings()` and `canRequestVenue()` in packages/shared) and opens that event's Request a venue page. Choosing a period in any view (or a day in Month) opens its details (SCRUM-85) in a popover beside it, as in 09a, with Open day view from Week and Month. The SCRUM-84 list and the 640 px week grid are gone; on a narrow screen the timeline scrolls sideways inside its box.
- Page layout rules (SCRUM-186, `apps/web` only, no migration): every signed-in page uses `PageFrame`, or `PAGE_MAIN`, `PageTitle` and `BackLink` from `components/PageFrame.tsx`, so all share one width, padding and title style. A page in the sidebar has no back link and is titled as the sidebar names it; a page reached from inside the app has one "Back to <place>" link above the title. `tests/unit/page-standards.test.tsx` checks this over every page. Not yet moved: `/change-requests/[id]` (redesigned on SCRUM-140, not merged), the sign-in pages, `/access-denied` and `/styleguide`.
- Mutation testing (SCRUM-187, no migration): `pnpm run test:mutation` runs Stryker on `packages/shared`, by hand and not in CI. Results, gaps found and what was left out are in `docs/testing/mutation-testing.md`.
- Dates that do not exist (SCRUM-190, no migration): `isRealDate()` in `packages/shared/src/venueBooking.ts`. Change requests, event edits, venue bookings and technical assignments now refuse a date such as 31 February instead of letting JavaScript roll it into March. Found by the mutation testing in SCRUM-187.
main
>>>>>>> origin/SCRUM-97/tentative-hold-expiry
