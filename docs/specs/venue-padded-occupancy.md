# Venue Padded Occupancy: Final User Story

User story for **Include Setup and Turnaround in Availability and Conflict Checks** (ConnectSphere, IS212),
compiled 2026-10-14.

- Scenario numbers are the test IDs: `103-S3` means SCRUM-103, Scenario 3. Jira does not number the ACs, so
  **Scenario n is AC n** in test names and commit titles **[PROPOSED]** (confirm with the PO).
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-103 | Include Setup and Turnaround in Availability and Conflict Checks | SCRUM-36 (double-hold rule), SCRUM-101 (the times, `docs/specs/venue-setup-turnaround.md`); interacts with SCRUM-98 (several bookings per event) and SCRUM-102 (change or cancel one booking) |

## Implementation decisions (2026-10-14)

These override the text below where they conflict.

- **One definition of "padded".** A booking's padded period is `[start - setup, end + turnaround)` using its venue's
  **current** setup and turnaround times (SCRUM-101). It is defined once in the database, `venue_padded_period(venue,
  start, end)`, with a TypeScript mirror `paddedPeriod` in `packages/shared` for unit tests and the fakes. The
  conflict check, the availability view and the venue search all use it, so a slot is never shown as free and then
  refused (Customer Briefing 8d). **[DECIDED]**
- **Two padded periods conflict when they overlap, half-open.** Both the held booking and the new request are padded.
  Periods that only touch do not conflict (103-S2). Holding statuses are unchanged: `requested`, `tentative`,
  `approved`, `confirmed` (DR5), so a Pending request is checked like an Approved one (103-S4). **[DECIDED]**
- **Current times, not a snapshot.** Raising a venue's times does not rewrite or invalidate existing bookings; it
  applies to the next check. A status-only update of an existing hold (Venue Staff approving) skips the check, so
  approving still works after padding is raised. **[DECIDED]**
- **The exclusion constraint is replaced by a trigger.** `venue_bookings_no_overlap` (migration 06) cannot see the
  venue's times, so migration `27_venue_padded_occupancy.sql` drops it and adds a `security definer` BEFORE
  INSERT/UPDATE trigger. The trigger locks the venue row (`FOR NO KEY UPDATE`) so two simultaneous requests for one
  venue are checked one after the other, then raises SQLSTATE 23P01 on a padded overlap. That is the code
  `venue-service` already maps to `SLOT_CONFLICT`, so the 36-S4 race guarantee is kept. **[DECIDED]**
- **New database functions** (`security definer`, executable by `authenticated`; the two that return periods allow
  coordinators and venue staff only, 42501 otherwise, and return no event, coordinator or request identity)
  **[DECIDED]**:
  - `venue_padded_period(venue, start, end) returns tstzrange`.
  - `venue_slot_conflicts(venue, start, end)`: the holding bookings whose padded period overlaps the padded request,
    with the venue name and times.
  - `venue_occupied_periods(venue, from, to)`: the holding bookings whose padded period overlaps a window, with event
    period, padded period and status, for the availability view.
  - `venue_slot_is_held` (migration 07) and `available_venues` (migration 18) are redefined with padding
    (`create or replace`; the old migrations are not edited). Maintenance blocks in `available_venues` stay unpadded.
- **Refusal message (103-S1).** `SLOT_CONFLICT` now says which period is occupied, in Singapore time, for example
  "Orchid Hall is occupied from 09:30 to 12:45, including setup and turnaround". When the venue's times are both 0 the
  suffix is left off ("Orchid Hall is occupied from 10:00 to 12:00"). It shows only the held period and the venue's
  name, never who holds it (36-S5). This replaces the old generic text "This venue is already held for part of that
  period." **[DECIDED]**
- **Several bookings per event (SCRUM-98, migration 28).** The one-booking-per-event rule is gone, so the trigger deliberately does
  not look at the event: two bookings at the same venue clash when their padded periods overlap whoever owns them, and the
  event's own other bookings are caught the same way. The service still answers an overlap with the event's own booking
  first, as `DUPLICATE_VENUE` (98-S13, 98-S14), and now compares padded periods for that too (103-S9). Bookings at
  different venues never conflict, so one event can hold two venues at the same time. **[DECIDED]**
- **Changing one booking (SCRUM-102, migration 30).** `change_venue_booking()` updates a booking's period in place, so the
  trigger runs on that update: it ignores the row being changed (`b.id <> new.id`), checks the new padded period against every
  other holding booking and raises 23P01, which the repository already maps to `SLOT_CONFLICT`. An update that leaves the venue
  and period as they are (a change of attendance or requirements, a decision, a withdrawal) skips the check, so it still works
  after the padding is raised. `BookingService.change()` runs the friendly pre-check too, with the booking itself excluded
  (`venue_slot_conflicts(..., p_exclude_booking_id)`), and rebuilds the message if it loses a race (103-S8). **[DECIDED]**
- **Amending and accepting a suggestion (SCRUM-60, SCRUM-59)** go through `submit()`, so they are padded without further code
  (103-S10). **[DECIDED]**
- **Losing the race.** If two requests pass the friendly check and the database refuses the second, `submit()` looks
  the conflict up again and gives the same specific message. **[DECIDED]**
- **Seam for SCRUM-109/110.** `SlotConflictRule.findConflict(venueId, start, end)` returns the first conflicting
  `OccupiedPeriod` (earliest first) or `null`; an optional fourth argument leaves out a booking being changed. **[DECIDED]**
- **Availability view.** `GET /venues/:id/availability?date=YYYY-MM-DD` (coordinators and venue staff, others 403; 404
  unknown venue; 422 bad date) returns the venue's times and the holding periods touching that Singapore day. The page
  `/venues/[id]/availability` shows each as a Setup, Event and Turnaround segment, labelled in text as well as colour,
  with its status. Maintenance blocks are not shown yet. **[DECIDED]**

---

## SCRUM-103 Include Setup and Turnaround in Availability and Conflict Checks

**User story.** As an Event Coordinator, I want venue availability and conflict checks to include each booking's setup
and turnaround time, so that I am never given a slot that Venue Staff cannot prepare and reset in time.

### Acceptance criteria

*AC1 (Scenario 1, the customer's worked example).* Given "Orchid Hall" has setup 30 minutes and turnaround 45 minutes,
and "Summit A" has an Approved booking for "Orchid Hall" on 2026-11-14, 10:00-12:00, when I submit a request for event
"Summit B" at "Orchid Hall" on 2026-11-14, 12:30-14:00, then the request is refused and the message states that "Orchid
Hall" is occupied from 09:30 to 12:45, including setup and turnaround.

*AC2 (Scenario 2, boundary).* Given the same "Summit A" booking, when I submit a request for "Orchid Hall" on
2026-11-14, 13:15-15:00 (occupies 12:45-15:45), then the request is created with status "Pending".

*AC3 (Scenario 3, my turnaround runs into an existing booking's setup).* Given the same "Summit A" booking (occupies from
09:30), when I submit a request for "Orchid Hall" on 2026-11-14, 08:00-08:50 (occupies until 09:35), then the request is
refused.

*AC4 (Scenario 4, Pending requests are checked the same way).* Given "Summit A" has a Pending request for "Orchid Hall"
on 2026-11-14, 10:00-12:00, when I submit a request for another event on 2026-11-14, 12:30-14:00, then the request is
refused.

*AC5 (Scenario 5, availability shows the padded period).* Given the "Summit A" booking in Scenario 1, when I view the
availability of "Orchid Hall" for 2026-11-14, then it is shown as occupied from 09:30 to 12:45, and the event time
(10:00-12:00) is distinguished from the setup and turnaround time.

*AC6 (Scenario 6, zero times keep the existing behaviour).* Given "Lotus Room" has setup 0 and turnaround 0 and an
Approved booking on 2026-11-14 ending at 12:00, when I submit a request for "Lotus Room" on 2026-11-14 starting at
12:00, then the request is created with status "Pending".

### Tests

| ID | Scenario |
| --- | --- |
| 103-S1 | 12:30-14:00 is refused `SLOT_CONFLICT` with exactly "Orchid Hall is occupied from 09:30 to 12:45, including setup and turnaround"; nothing is created; the body names no event or coordinator (AC1). `paddedPeriod` and `slotConflictMessage` unit tests. |
| 103-S2 | 13:15-15:00 is created Pending; the padded periods only touch (AC2). |
| 103-S3 | 08:00-08:50 is refused (AC3). |
| 103-S4 | A Pending holder refuses 12:30-14:00 the same way (AC4). |
| 103-S5 | The availability endpoint returns the booking's event period and padded period; the page shows Setup 09:30-10:00, Event 10:00-12:00 and Turnaround 12:00-12:45, occupied 09:30-12:45 (AC5). Coordinators and staff only; 404; 422. |
| 103-S6 | With 0 and 0, 12:00 after a booking ending 12:00 is created; the message has no suffix when a zero-padded booking does conflict (AC6). |
| 103-S7 | Losing the race to the database still gives the specific message. |
| 103-S8 | Changing one booking (SCRUM-102): into a padded clash is refused with the occupied period and changes nothing; to where the padded periods only touch is accepted and goes back to PENDING; within its own padding is accepted; losing the race still gives the specific message (AC1, AC2). |
| 103-S9 | Several bookings per event (SCRUM-98): the event's own other booking at the same venue clashes through the padding as `DUPLICATE_VENUE`, also when a booking is changed; padded periods that only touch are accepted; different venues never clash (AC1, AC2). |
| 103-S10 | Amending a rejected booking (SCRUM-60) into a padded clash is refused with the occupied period (AC1). |
| DB | `venue_padded_period`; the trigger refuses padded overlaps (all holding statuses), allows touching and other venues; a coordinator's insert is checked against another coordinator's hold; approving after the padding is raised still works; `change_venue_booking()` (migration 30) into a padded clash is 23P01, to a touching period works, within its own padding works, and a change of numbers alone still works after the padding is raised; two bookings of one event at one venue are refused by the trigger when their padding overlaps, while two venues at the same time are allowed; 20 simultaneous requests for one padded slot create exactly one; `venue_slot_is_held`, `venue_slot_conflicts`, `venue_occupied_periods` and `available_venues` all agree, and the period functions refuse other roles (AC1 to AC6). |
| E2E | Availability page for Orchid Hall shows the split; the 12:30 request is refused with the message; 13:15 is created (AC1, AC2, AC5). |
