# Venue Buffer Conflicts: Final User Story

User story for **Identify Existing Bookings That Conflict Under New Times** (ConnectSphere, IS212), compiled 2026-10-15.

- Scenario numbers are the test IDs: `104-S3` means SCRUM-104, Scenario 3. Jira does not number the ACs, so
  **Scenario n is AC n** in test names and commit titles **[PROPOSED]** (confirm with the PO).
- Markers: **[DECIDED]** the team chose it (the Wave 2 plan of 2026-10-15). **[PROPOSED]** a default, confirm or change.
- **Built on `main` after Wave 1** (SCRUM-101, 103, 109, 110 are merged; migration 33 is SCRUM-110's, 34 is SCRUM-111's). This
  story is migration **36**; 35 is reserved for SCRUM-46 (notifications). Corrections found while building are marked
  **[CORRECTED]**.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-104 | [Setup and Turnaround Time] Identify Existing Bookings That Conflict Under New Times | SCRUM-101 (the times, `docs/specs/venue-setup-turnaround.md`), SCRUM-102 (change or cancel one booking, `docs/specs/change-cancel-venue-booking.md`); built on SCRUM-103 (`docs/specs/venue-padded-occupancy.md`); interacts with SCRUM-98, SCRUM-105 and SCRUM-106 |

SCRUM-103 stops a new request that would clash with an existing booking's setup or turnaround time. It deliberately lets
existing bookings stand when Venue Staff later raise a venue's times (the times are "current", not a snapshot). This story
deals with what that leaves behind: two bookings that were fine before and now overlap once padded. It flags them. It never
cancels, withdraws or moves anything.

## Implementation decisions (2026-10-15)

These override the text below where they conflict.

- **A flag is a row, not a status.** A booking's `status` and its event's status are never touched by a flag (Jira note:
  status transitions are not automated; the Coordinator resolves a flag by cancelling one booking, SCRUM-102, or moving it).
  A new table `venue_booking_flags` holds them (migration `36_venue_booking_flags.sql`), because one booking can carry several
  flags, each flag must name the other booking and clear on its own, and a status column cannot do any of that. **[DECIDED]**
- **Table shape.** `id`, `booking_id` (the flagged booking), `kind` (`buffer_conflict` or `venue_unavailable`),
  `other_booking_id` (buffer conflicts) or `unavailability_id` (SCRUM-106), exactly one of them set, and it must match the kind
  (check constraint); `other_start` and `other_end`, a copy of the other booking's event period so a coordinator can be shown it
  without reading a booking that is not theirs; `created_at`; `resolved_at` and `resolved_reason`. An open flag has
  `resolved_at is null`. Partial unique indexes on open flags: `(booking_id, other_booking_id)` and
  `(booking_id, unavailability_id)`, so a refresh never raises the same flag twice. The table stores **no event names**
  (36-S5); a name is joined at read time and only in the Venue Staff DTOs. **[DECIDED]**
- **`resolved_reason`** is one of `no_longer_conflicts` (the conflict went away: the times changed, 104-S5, or a booking
  moved, SCRUM-102), `booking_closed` (a booking stopped holding) or `replaced` (SCRUM-107). A check constraint holds the list,
  and `resolved_at` and `resolved_reason` are set together. **[CORRECTED]** (the first draft had `padding_changed` and
  `booking_moved`; one reason, `no_longer_conflicts`, covers both because the trigger tests the overlap, not the cause.)
- **Who may read.** Row-level security allows SELECT for venue staff and for the coordinator assigned to the flagged booking's
  event, through a `security definer` helper `can_read_venue_booking(booking_id)` (new in migration 36; the existing
  `is_assigned_coordinator(event_id)` and `current_user_role()` from migration 07 do the work). Nobody gets INSERT, UPDATE or
  DELETE through the API; only the definer functions below write. The header of the migration documents the role matrix.
  The organiser cannot read venue bookings at all (migration 08), so cannot read flags either. **[DECIDED]**
- **What counts as a conflict.** Two bookings of one venue whose **padded periods** overlap, half-open, both **holding**
  (`requested`, `tentative`, `approved`, `confirmed`, DR5), and both **still in the future** (the later of the two bookings has
  not ended: `event_end_datetime > now()`). Bookings that already ended are history and are never flagged. Both bookings get a
  flag, each naming the other (104-S1). A Pending request is checked like an Approved one (104-S4). **[DECIDED]**
- **Padded periods come from `venue_padded_period(venue, start, end)`** (SCRUM-103, migration 27), the single definition,
  using the venue's current times. The detection compares the periods inside the database directly. It does **not** call the
  role-gated `venue_slot_conflicts` or `venue_occupied_periods`, which only answer a signed-in coordinator or venue staff user, so they cannot run inside a definer function called by the service role. **[DECIDED]**
- **Detection is a reconcile.** `refresh_buffer_flags(venue_id)` (security definer, internal, not executable by clients)
  locks the venue row `FOR NO KEY UPDATE` (the same lock as SCRUM-103's overlap trigger), finds every conflicting pair
  (`venue_buffer_pairs()`), inserts the flags that are missing, keeps the copied periods current and resolves the open ones
  whose pair no longer overlaps (`no_longer_conflicts`). Saving 15 and 15 therefore clears the flags raised by 30 and 45
  (104-S5), and the same call with nothing to find flags nothing (104-S6). **[DECIDED]**
- **`set_venue_timing` is re-created.** Migration 26 made it `returns void`; Postgres will not change a return type with
  `create or replace`, so migration 36 drops it and creates it again with the same arguments and grants, now returning the
  affected pairs (`booking_id`, `event_name`, `event_start`, `event_end`, `occupied_until`, `other_booking_id`,
  `other_event_name`, `other_event_start`, `other_event_end`, `other_occupied_from`; the earlier booking first). It updates
  the venue, calls `refresh_buffer_flags` in the **same transaction**, and writes the same `activity_log` row (DR13), with
  the number of pairs added when there are any. The role check (`venue_staff` only, 42501) is unchanged. **[DECIDED]**
- **Bookings change the flags too.** An AFTER UPDATE trigger on `venue_bookings` (of `status`, `venue_id`,
  `event_start_datetime`, `event_end_datetime`) resolves every open flag that involves the booking when it stops holding
  (`booking_closed`: rejected, withdrawn, cancelled; `replaced` for SCRUM-107's status) and, when a holding booking moves,
  the buffer flags whose pair no longer overlaps padded (`no_longer_conflicts`). It compares `new.status` as text, so it works
  before the enum has `replaced`. It only ever resolves and never inserts: a move cannot create a buffer conflict, because
  SCRUM-103's trigger refuses a change into a padded clash. Deciding an Approved booking or changing its numbers leaves
  flags as they are. **[DECIDED]**
- **A flagged Pending request cannot be approved (104-S4).** Enforced twice. The service refuses with `409 BOOKING_FLAGGED`
  before `decide()`; a `BEFORE UPDATE` trigger on `venue_bookings` raises SQLSTATE `CS104` when a booking with an open flag
  goes from `requested` to `approved`, which closes the gap if two staff act at once or the service is bypassed. Rejecting is
  always allowed. `BOOKING_FLAGGED` is new in `VENUE_BOOKING_ERROR_CODES` with the message "This request is flagged and cannot
  be approved until the conflict is resolved. You can still reject it." **[PROPOSED]** (the wording; the behaviour is the Jira
  scenario). The guard covers **both flag kinds**, so SCRUM-106 needs no second guard. A flag raised at the same moment as an
  approval is fine either way: the booking ends up flagged, approved or not.
- **Fix a latent bug on the way.** In `supabaseBookingRepository.ts` `transitionFromPending` throws a plain `Error` on any
  database error, so a trigger refusal (`CS104`) would come back as a 500. It now passes the error through `translate()` like
  `change` and `cancel` already do; `translate()` maps `CS104` to `BOOKING_FLAGGED`. **[DECIDED]**
- **Endpoint change.** `PUT /venues/:id/timing` (SCRUM-101) keeps its 200 body and adds `affected` and `message`:

  | Field | Value |
  | --- | --- |
  | `setup_minutes`, `turnaround_minutes` | unchanged from SCRUM-101 |
  | `affected` | every open buffer-conflict pair at the venue after the save, `[]` when none. Each item: `summary` (the sentence in 104-S1), `first` and `second` (`bookingId`, `eventName`, `date`, `startTime`, `endTime`, `occupiedFrom`, `occupiedUntil`), `first` being the earlier booking |
  | `message` | "No existing bookings are affected." when `affected` is empty, otherwise "1 pair of bookings is flagged." or "n pairs of bookings are flagged." (`bookingsAffectedMessage` in shared) |

  Status codes are SCRUM-101's (403 before validation, 404, 422). SCRUM-101's integration test asserts the old body with
  `toEqual`; it changes to `toMatchObject`. **[DECIDED]**
- **Flags in the DTOs.** `flags: FlagDto[]` (type in `packages/shared/src/venueBookingFlags.ts`, written with this spec) is added to
  the coordinator's booking list, booking detail and event-booking items, and to the Venue Staff queue items and detail. A
  coordinator's `FlagDto` carries the other booking's `otherPeriod` (Singapore date, `HH:MM` start and end) and **no event name**
  (36-S5); a Venue Staff `FlagDto` adds `otherEventName`. The list shows open flags only. **[DECIDED]**
- **Reading a flag as a coordinator** goes through the caller's own RLS (the flag table's policy above), so a coordinator who
  has been reassigned off the event no longer sees it. **[DECIDED]**
- **Web.** `VenueTimingForm` lists the affected pairs after a save (or "No existing bookings are affected."). The Venue Staff
  queue and queue detail show a "Flagged" badge and a banner naming the flag label; `decisionActions(status, flagged)` hides
  Approve for a flagged request and keeps Reject. The coordinator's `/venue-bookings` list and the booking detail show the
  flag label with the other booking's time ("Buffer conflict: another booking at this venue, 12:30 to 14:00 on 14 Nov"). The
  coordinator dashboard gains a "My venue bookings" link to `/venue-bookings`, which is the only way in from the dashboard
  today. Flags are always text, never colour alone. **[DECIDED]**
- **Shared code (no dependency on Wave 1).** `packages/shared/src/venueBookingFlags.ts` holds the flag kinds, their labels
  ("Buffer conflict", "Venue unavailable – alternative needed", with an en dash), `FlagDto`, `NO_BOOKINGS_AFFECTED_MESSAGE` and
  `bufferConflictSummary`, which words 104-S1 in Singapore time and adds a date to any time that falls on another day than its
  own booking's. It is written before Wave 1 merges because it needs only `utcToSgt`. **[DECIDED]**
- **Race.** **[CORRECTED]** The first draft said both functions take the venue row lock first. They do not:
  `change_venue_booking` locks the booking row (`FOR UPDATE`, migration 30) and only then the venue row (through 27's
  trigger), while `set_venue_timing` updates the venue row and then needs a key-share lock on each booking to insert its flags.
  That is a lock cycle. `set_venue_timing` now locks the venue's holding bookings (`FOR NO KEY UPDATE`, in id order) **before**
  the venue row, the same order as `change_venue_booking`, so they queue instead of deadlocking. The `40P01` retry is also
  added to the timing writer, as a second line of defence. A test runs 20 rounds of both at once. **[DECIDED]**

---

## SCRUM-104 Identify Existing Bookings That Conflict Under New Times

**User story.** As Venue Staff, I want to see which existing bookings conflict once a venue's setup or turnaround time
changes, so that they are dealt with rather than silently removed.

### Acceptance criteria

*AC1 (Scenario 1, conflicts are shown when I save).* Given "Orchid Hall" has setup 0 and turnaround 0 and Approved bookings on
2026-11-14 for "Summit A" (10:00-12:00) and "Summit B" (12:30-14:00), when I change its setup to 30 and turnaround to 45 and save,
then the save succeeds, I am shown that "Summit A" (occupies until 12:45) now conflicts with "Summit B" (occupies from 12:00),
and both bookings are flagged "Buffer conflict", each referencing the other.

*AC2 (Scenario 2, nothing is removed).* Given the bookings in AC1 have been flagged, when I view them, then both remain
"Approved" and neither has been withdrawn or cancelled.

*AC3 (Scenario 3, coordinators can see the flag).* Given the "Summit B" booking is flagged "Buffer conflict", when its assigned
Event Coordinator opens their venue bookings list, then the booking shows the flag and the time of the conflicting booking.

*AC4 (Scenario 4, a flagged Pending request cannot be approved).* Given a Pending request is flagged "Buffer conflict" because it
conflicts with an Approved booking, when Venue Staff open the request, then the approve action is unavailable and the reject
action is available.

*AC5 (Scenario 5, the flag clears when the conflict no longer exists).* Given "Summit A" and "Summit B" are flagged as in AC1,
when I change setup to 15 and turnaround to 15 (Summit A occupies until 12:15, Summit B from 12:15), then both flags are removed.

*AC6 (Scenario 6, no conflicts, no flags).* Given no existing bookings would conflict under the new times, when I save the
change, then no bookings are flagged and I am told that no existing bookings are affected.

### Notes from Jira

Week 7 Change 1: "Existing bookings that become problematic under the new rule should be identified rather than silently
removed." Flags do not change booking or event status. A Coordinator can resolve a flag by cancelling one booking (SCRUM-102) or
moving it (SCRUM-102, change). Replacing a flagged booking is SCRUM-107, which is for the **Venue unavailable** flag only (see
open questions).

### Interaction with other stories

- **SCRUM-103.** Reuses `venue_padded_period`. The 103 test "approving after padding is raised still works" must stay green
  for a booking that is **not** flagged; a flagged one is now refused by design (104-S4). Both are tested.
- **SCRUM-102.** Changing a booking to a new period resolves its flags (`booking_moved`); cancelling it resolves them
  (`booking_closed`). `change_venue_booking()` sends an Approved booking back to Pending (102-S2) and Pending requests with an
  open flag cannot then be approved until the flag is gone, which a move always does.
- **SCRUM-98.** Several bookings per event: the two bookings of a pair can belong to the same event. The flag does not look
  at the event.
- **SCRUM-105 / 106.** Add the second kind (`venue_unavailable`, `unavailability_id`) to the same table; 106 extends
  `refresh_buffer_flags` into `refresh_venue_booking_flags`. The approve guard and the DTO need no further change.
- **SCRUM-110.** `change_venue_booking()` is re-created by SCRUM-110's suitability migration (33, on `main`). Migration 36
  does not touch it.

### Tests

| ID | Scenario |
| --- | --- |
| 104-S1 | Setting 30 and 45 with Summit A 10:00-12:00 and Summit B 12:30-14:00 returns `affected` with the sentence "Summit A (occupies until 12:45) now conflicts with Summit B (occupies from 12:00)"; one flag on each booking, each referencing the other (AC1). `bufferConflictSummary` (shared) unit tests: Singapore time, a date added when a time falls on another day. |
| 104-S2 | Both bookings are still `approved`, with no `cancelled_*` or `withdrawn_*` set, and their event's status and row are unchanged (AC2). |
| 104-S3 | The assigned coordinator's list and detail carry the flag and the other booking's period and no event name; another coordinator and an organiser see nothing; RLS test on the table (AC3). |
| 104-S4 | A flagged Pending request: the approve call is `409 BOOKING_FLAGGED` and the row is unchanged; reject works; a direct database update to `approved` raises `CS104`; the UI hides Approve and shows Reject (AC4). Two staff approving and saving times at once leaves no approved-and-unflagged pair. |
| 104-S5 | Saving 15 and 15 resolves both flags (`padding_changed`) and `affected` is empty; the booking then approves normally (AC5). |
| 104-S6 | Saving times that clash with nothing flags nothing and returns "No existing bookings are affected." (AC6). |
| 104-S7 | A booking that already ended is not flagged; touching padded periods (12:15 and 12:15) are not flagged; a rejected, withdrawn or cancelled booking is not flagged and not a partner (AC1, AC5). |
| 104-S8 | Cancelling or moving a flagged booking (SCRUM-102) resolves its flag and the partner's (AC5). |
| 104-S9 | `set_venue_timing` still refuses a coordinator (42501), a bad range, and logs the change; `transitionFromPending` turns a trigger refusal into `BOOKING_FLAGGED`, not a 500. |
| 104-S10 | RLS on `venue_booking_flags`: venue staff read every flag, the assigned coordinator only the flags on their own bookings, an organiser none; nobody inserts, updates or deletes through the API; `refresh_buffer_flags` is not callable by a signed-in user; the check constraint ties each kind to its one target. |
| Race | 20 rounds of `set_venue_timing` against `change_venue_booking` on one venue end with a consistent flag set and no deadlock failure (`tests/integration/bufferConflicts.test.ts`, 104-S10 block). |
| E2E | `apps/web/tests/e2e/venue-buffer-conflicts.spec.ts` (opt in with `E2E_FULL_STACK=1`): Kenneth sets Orchid Hall to 30 and 45, sees the Summit A and B sentence; Rachel opens My venue bookings from her dashboard and sees "Buffer conflict" with Summit A's period and not its name; Approve is missing for the flagged Pending request and Reject is there; 15 and 15 clears the flags, says no bookings are affected, and Approve returns (AC1 to AC6). |

### Out of scope

- Cancelling, withdrawing or moving a flagged booking for the user (the Coordinator does it, SCRUM-102).
- Notifying anyone about a buffer conflict (Jira asks for visibility on the list only; notifications are SCRUM-106 for
  unavailability).
- Flags for the venue unavailable kind (SCRUM-105/106) and replacing a booking (SCRUM-107).
- Email or SMS.

### Open questions for the product owner

1. **Buffer-conflict flags are shown to the coordinator but nobody is notified.** Jira SCRUM-104 only asks for the flag on the
   list (104-S3). Should the assigned coordinators also be notified, as SCRUM-106 does for unavailability? Proposed: no.
2. **May a booking flagged "Buffer conflict" be replaced** with SCRUM-107's "Find replacement"? Proposed: no, resolve it with
   SCRUM-102 (cancel or change one booking).
3. **Wording of the refusal.** "This request is flagged and cannot be approved. You can reject it." Proposed.
4. **Do both bookings in a pair need a flag when one of them is merely Pending?** Jira says "both ... each referencing the other".
   Proposed: yes, always both.
