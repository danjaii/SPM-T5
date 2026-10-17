# Flag Bookings Affected by Venue Unavailability: Final User Story

User story for **Flag Bookings Affected by Venue Unavailability** (ConnectSphere, IS212), compiled 2026-10-15.

- Scenario numbers are the test IDs: `106-S4` means SCRUM-106, Scenario 4. Jira does not number the ACs, so
  **Scenario n is AC n** in test names and commit titles **[PROPOSED]** (confirm with the PO).
- Markers: **[DECIDED]** the team chose it (the Wave 2 plan of 2026-10-15). **[PROPOSED]** a default, confirm or change.
- **Not built yet.** Written before the code. It builds on SCRUM-104 (the flag table and the approve guard,
  `docs/specs/venue-buffer-conflicts.md`), SCRUM-105 (the block, `docs/specs/venue-unavailability.md`) and SCRUM-46 (the
  notifications table, its own spec in that PR). Facts about SCRUM-103 and migration 27 are read from the Wave 1 branches.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-106 | [Venue Unavailability] Flag Bookings Affected by Venue Unavailability | SCRUM-104 (flags, approve guard), SCRUM-105 (the block), SCRUM-46 (view notifications; Jira also names SCRUM-47, whose other triggers stay unassigned); built on SCRUM-103 (padding) |

## Implementation decisions (2026-10-15)

These override the text below where they conflict.

- **A flag, never a status change (106-S1).** The affected booking keeps its status. The event's status, date, time, expected
  attendance and requirements are not touched, and the venue booking row is not written at all: the flag is a row in
  `venue_booking_flags` (SCRUM-104). A Coordinator resolves it by replacing the booking (SCRUM-107), changing it
  or cancelling it (SCRUM-102). **[DECIDED]**
- **Which bookings.** Every booking of the venue that is **holding** (`requested`, `tentative`, `approved`, `confirmed`),
  **still in the future** (`event_end_datetime > now()`), and whose **padded period** (`venue_padded_period`, SCRUM-103)
  overlaps the block `[start, end)`, half-open. Setup and turnaround both count (106-S4). A Pending request is flagged like
  an Approved booking (106-S3). **[DECIDED]**
- **Same transaction as the block.** Migration `43_venue_unavailability_flags.sql` (39 was taken by SCRUM-105 while this was written):
  1. adds `refresh_venue_booking_flags(venue, block default null)`, which runs SCRUM-104's `refresh_buffer_flags(venue)` (same
     venue row lock) and then flags the bookings a block overlaps. With a block id it considers that block only (the trigger
     passes the new one); without, every block that has not ended. It only raises flags: resolving stays with SCRUM-104's
     trigger on `venue_bookings`;
  2. adds an `AFTER INSERT` trigger on `venue_unavailability` that calls it, so the flags are written inside
     `mark_venue_unavailable` (SCRUM-105) and a block can never exist without its flags;
  3. re-creates `mark_venue_unavailable` to return `(block_id, flagged_count)` (a return type cannot change with `create or
     replace`, so it is dropped and created again with the same grants, like `set_venue_timing` in SCRUM-104);
  4. adds the notification trigger below. **[DECIDED]**
- **A `venue_unavailable` flag** has `unavailability_id` set (not `other_booking_id`), and `other_start`/`other_end` holding
  a copy of the block's period. The partial unique index on `(booking_id, unavailability_id)` makes a refresh idempotent: a
  booking is flagged once per block, and so notified once. **[DECIDED]**
- **Resolving.** SCRUM-104's trigger on `venue_bookings` resolves a flag when its booking stops holding (`booking_closed`)
  or moves (`booking_moved`); a move into a block is refused (`CS105`, SCRUM-105), so a moved booking is clear of it. SCRUM-107
  resolves it as `replaced`. Blocks cannot be edited or deleted (SCRUM-105), so nothing else clears a flag. The DTO shows
  only open flags of bookings that have not ended. **[DECIDED]**
- **One notification, for the assigned coordinator (106-S2, 106-S5).** An `AFTER INSERT` trigger on `venue_booking_flags`
  (kind `venue_unavailable`) writes one row to `notifications` for **`events.assigned_coordinator_id`** of the booking's
  event, not `venue_bookings.requested_by`: `requested_by` is whoever submitted the request and goes stale when a Lead
  reassigns the event (SCRUM-102 follows the same rule). If the event has no assigned coordinator, the flag is raised and
  nobody is notified. Nobody else is notified: not Venue Staff, organisers, attendees or other coordinators. **[DECIDED]**
- **The notification row.** `type = 'venue_booking_flagged'` (added to SCRUM-46's `NOTIFICATION_TYPES`), `event_id` the
  event, `venue_booking_id` the flagged booking (SCRUM-46's typed link, which is what makes "selecting it opens the flagged
  booking" work: the link is `/venue-bookings/<id>`), `title` "Venue unavailable – alternative needed" and a `message`
  built in SQL from the event's name, the venue, the booked period, the block's period and the reason label. For example:
  `TechConf 2026: your booking for Orchid Hall on 14 Nov 09:00 to 17:00 is affected. Orchid Hall is unavailable from 14 Nov
  08:00 to 16 Nov 18:00 (Maintenance). Request a replacement venue.` Dates use the Singapore short form of SCRUM-105
  (`to_char(t at time zone 'Asia/Singapore', 'FMDD Mon HH24:MI')`; the month abbreviation is English whatever the
  server locale), so they match `formatShortSgt` in `packages/shared`. A parity test runs the SQL against the TypeScript.
  A booking that spans a single day shows its end time only ("14 Nov 09:00 to 17:00"). **[DECIDED]**
- **The write is part of the transaction.** SCRUM-46 revokes INSERT on `notifications` from signed-in users and its header
  names this trigger as a producer. If the notification cannot be written, the block is rolled back, so no coordinator is ever
  left un-told (an outbox written in the same transaction as the change; email and SMS dispatch from it come later). **[DECIDED]**
- **Approving a flagged request is refused (106-S3).** SCRUM-104's service check (`409 BOOKING_FLAGGED`) and its database
  trigger (`CS104`) already cover **both kinds**, and reject stays available. This story adds only tests that use the new kind.
  A Pending request that was already inside the block is therefore protected from the moment the block is saved, which closes
  the window SCRUM-105 leaves open. **Merge 106 straight after 105.** **[DECIDED]**
- **Read path.** `flagsFor()` reads the block's reason through the flag's `venue_unavailability` link. Both Venue Staff and
  coordinators may read `venue_unavailability` (migration 39), so the join works under each caller's RLS. **[DECIDED]**
- **DTO.** `FlagDto` (shared, SCRUM-104) gains an optional `unavailability` object for this kind:
  `{ startDate, startTime, endDate, endTime, reason, reasonLabel }` in Singapore time, because a block can span days and
  `otherPeriod` is a single day. For this kind `otherPeriod` is null. The coordinator sees the period and the reason label;
  Venue Staff see the same. `label` is "Venue unavailable – alternative needed". **[DECIDED]**
- **Endpoint change.** `POST /venues/:id/unavailability` (SCRUM-105) keeps its 201 body and adds `affectedBookings`
  (the number of bookings flagged). Status codes are SCRUM-105's. **[DECIDED]**
- **Web.** The booking detail and list show a banner "Venue unavailable – alternative needed" with the block's period
  and reason ("Orchid Hall is unavailable from 14 Nov 08:00 to 16 Nov 18:00 (Maintenance)"); in the Venue Staff queue the
  request carries the same "Flagged" badge and has no Approve button, only Reject. After saving a block, the unavailability
  form says "3 bookings affected; their coordinators have been notified" (or "No existing bookings are affected."). The text
  of the flag is always words, never colour alone. "Find replacement" is SCRUM-107's. **[DECIDED]**
- **Seeded accounts for the demo and E2E.** There is **no** seeded block on 12 Dec 2026 (the plan said there was). The
  seeded Riverside Grand Ballroom block is 12 to 16 Oct 2026 (maintenance). The Pacific Rim Gala venue booking at Riverside is
  `confirmed` for the `confirmed` event "Pacific Rim Trade Association Gala Dinner", whose assigned coordinator is Rachel Tan.
  The seed writes times with no time zone, which the database reads in its own zone (UTC on Supabase), so the booking falls on 13 Dec 02:30 to 06:30 Singapore time; the E2E
  creates the block through the app (Kenneth Wong) with a window that covers it, then expects exactly one new notification,
  for Rachel. **[DECIDED]**
- **Race.** `mark_venue_unavailable` and a new request take the same venue row lock first (SCRUM-103, SCRUM-105). If the
  request commits first, the block's refresh sees it and flags it; if the block commits first, the request is refused
  (`CS105`). Either way no booking ends up inside a block without a flag. A test runs 20 rounds. **[DECIDED]**

---

## SCRUM-106 Flag Bookings Affected by Venue Unavailability

**User story.** As an Event Coordinator, I want to be told when a venue booked for my event becomes unavailable, so that I
can arrange an alternative without the event being cancelled.

### Acceptance criteria

*AC1 (Scenario 1, an affected booking is flagged, not cancelled).* Given "TechConf 2026" has an Approved booking for "Orchid
Hall" on 2026-11-14, 09:00-17:00, and I am its assigned Coordinator, when Venue Staff mark "Orchid Hall" unavailable from
2026-11-14 08:00 to 2026-11-16 18:00, then the booking is flagged "Venue unavailable – alternative needed", the booking status
remains "Approved", and the event's status, date, time, expected attendance and requirements are unchanged.

*AC2 (Scenario 2, I am notified).* Given the booking in AC1 has just been flagged, when I open my notifications, then I have
one notification showing the event name, venue, booked period, unavailability period and reason, and selecting it opens the
flagged booking.

*AC3 (Scenario 3, pending requests are also flagged).* Given "Summit C" has a Pending request for "Orchid Hall" on 2026-11-15,
09:00-12:00, when the unavailability period in AC1 is created, then the request is flagged and its assigned Coordinator is
notified, and when Venue Staff open the request, the approve action is unavailable and the reject action is available.

*AC4 (Scenario 4, boundary, where setup time overlaps the period).* Given "Orchid Hall" has setup 30 minutes and it has
Approved bookings on 2026-11-16 for 18:15-20:00 (occupies from 17:45) and 18:30-20:00 (occupies from 18:00), when the
unavailability period in AC1 is created, then only the 18:15 booking is flagged and its Coordinator notified.

*AC5 (Scenario 5, only affected Coordinators are notified).* Given the unavailability period affects one booking, when it is
created, then no other Coordinator, Event Organiser or Attendee receives a notification about it.

### Notes from Jira

Week 7 Change 2. This matches the G1 Week 4 answer (Bryan): Venue Staff availability changes notify the coordinator, who liaises
with the organiser offline. It also matches the G1 Week 2 answer (Claris): status transitions are not automated.

### Interaction with other stories

- **SCRUM-104.** Shares the table, the refresh, the approve guard, the resolving trigger and `FlagDto`. 104's tests for
  buffer conflicts stay green; the refresh must not resolve the other kind's flags (tested).
- **SCRUM-105.** The block trigger runs inside its RPC. A block that overlaps nothing flags nothing and notifies nobody.
- **SCRUM-46 / 47.** Writes a row of the notifications table that 46 built (own-row read, mark as read). 47's other triggers
  (assignment, clarification, approval, mentions) stay unassigned. If 46 has not merged, 106 cannot be built.
- **SCRUM-102.** A flagged booking can still be changed or cancelled; doing so resolves its flag. The notification is not
  removed, and still opens the booking, which then shows no flag.
- **SCRUM-107.** The flag is the precondition for "Find replacement"; an approved replacement resolves it as `replaced`.
- **SCRUM-98.** An event with several bookings at the venue gets one notification per flagged booking. **[PROPOSED]**

### Tests

| ID | Scenario |
| --- | --- |
| 106-S1 | Kenneth marks Orchid Hall unavailable 14 Nov 08:00 to 16 Nov 18:00: the 14 Nov 09:00 to 17:00 booking carries one open `venue_unavailable` flag; its status is still `approved`; the booking row and the event row are byte-identical to before (AC1). |
| 106-S2 | Rachel has exactly one new notification of type `venue_booking_flagged` whose title and message give the event name, venue, booked period, block period and reason ("TechConf 2026", "Orchid Hall", "14 Nov 09:00 to 17:00", "14 Nov 08:00 to 16 Nov 18:00", "Maintenance"); `venue_booking_id` is the booking and the notification's `href` opens it (AC2). The SQL message equals the TypeScript wording for the same inputs (parity test). |
| 106-S3 | A Pending request for 15 Nov 09:00 to 12:00 is flagged and its coordinator notified; `approve` is `409 BOOKING_FLAGGED` and the database trigger refuses it (`CS104`); `reject` with a reason works; the queue shows no Approve (AC3). |
| 106-S4 | Setup 30: with only the 18:15 to 20:00 booking present it is flagged and its coordinator notified; in a separate fixture with only the 18:30 to 20:00 booking it is not flagged and nobody is notified (AC4). The two bookings of the Jira scenario overlap each other once padded, so they cannot coexist in one venue (SCRUM-103); see open question 1. |
| 106-S5 | With one affected booking, the `notifications` table gains exactly one row; no other coordinator, the organiser, an attendee or Venue Staff has a new row; a booking at another venue or outside the period is not flagged; a booking whose event has no assigned coordinator is flagged with no notification; a reassigned event notifies the new coordinator, not the requester (AC5). |
| 106-S6 | A block that overlaps no booking returns `affectedBookings: 0` and writes no flag and no notification; a booking that has ended, a rejected, withdrawn or cancelled booking, and a booking that only touches the block are not flagged. |
| 106-S7 | Refreshing twice (a second block over the same booking) flags once per block and notifies once per flag; resolving 104's buffer flags does not close the unavailable ones, and the reverse. |
| 106-S8 | RLS: the assigned coordinator and venue staff read the flag, another coordinator and an organiser do not; a signed-in user cannot insert a flag or a notification directly. |
| Race | 20 rounds of `mark_venue_unavailable` against a new request in the same window: the request is refused, or created and flagged; never created, inside a block and unflagged; no deadlock error. |
| E2E | Kenneth Wong marks Riverside Grand Ballroom unavailable over the Pacific Rim Gala booking; Rachel's dashboard shows "Notifications (1 unread)"; opening it marks it read and lands on the flagged booking with the banner; no other seeded user has a new notification (AC1, AC2, AC5). |

### Out of scope

- Replacing the booking (SCRUM-107).
- Email or SMS (SCRUM-47's dispatch), and notifying the organiser or Venue Staff.
- Un-flagging when a block ends or is removed; blocks cannot be edited or deleted (SCRUM-105).
- Backfilling flags for blocks created before this migration (the four seeded blocks).
- Cancelling or moving the booking for the Coordinator.

### Open questions for the product owner

1. **106-S4 is not buildable as written.** Its two Approved bookings (18:15 to 20:00 and 18:30 to 20:00) overlap each other once
   Orchid Hall has setup 30, which SCRUM-103 refuses at the moment of booking. Proposed: test them as two separate cases of the
   same venue, as in the table above. Is that acceptable evidence?
2. **Should the notification say why?** The refusal in SCRUM-105 omits the reason (proposed), but the notification must show
   it (this story's AC2). Is that the intended difference? Proposed: yes; a coordinator needs it to plan, a requester does not.
3. **May a booking flagged "Buffer conflict" also be replaced** by SCRUM-107? Proposed: no.
4. **One notification per flagged booking, or one per event?** Proposed: per booking, because each opens its own booking.
5. **Should Venue Staff be told how many coordinators were notified?** Proposed: yes, as a count in the form (above).
