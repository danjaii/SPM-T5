# Lift a Venue Unavailability Block: Final User Story

User story for the **lift a block** part of SCRUM-185 ([Venue Unavailability] A Blocked Venue Reverts a Confirmed Event to
Planning, and a Block Can Be Lifted), ConnectSphere, IS212, compiled 2026-11-02.

- Scenario numbers are the test IDs: `185-S2` means SCRUM-185, the scenario for **AC2** (lifting a block). Test names carry
  `SCRUM-185/AC2` and the scenario ID.
- Markers: **[DECIDED]** follows an earlier team decision or the customer. **[PROPOSED]** a default, confirm or change.
- **Scope of this PR: AC2 only.** AC1 (a block sends a confirmed event back to Planning; it reverses the SCRUM-106 team
  decision that a flag never changes a status), AC3 (the replacement-confirmed notice) and AC4 (the registration pause) wait
  on decisions the customer has not made (`REQUIREMENTS_STATUS.md`, W9 r42 against r50). They are not built here.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-185 | [Venue Unavailability] A Blocked Venue Reverts a Confirmed Event to Planning, and a Block Can Be Lifted | SCRUM-105 (the block), SCRUM-106 (the flags and their notification), SCRUM-46 (notifications) |

## Why

Venue Staff can mark a venue unavailable (SCRUM-105) but a block, once saved, can never be removed. When the maintenance is
cancelled or finished early, the venue stays closed to new requests, and the coordinators who were told to find a replacement
(SCRUM-106) are never told they no longer need to. The customer said in the Week 9 Q&A that a block can be lifted.

## Implementation decisions

- **Lifting deletes the block.** `venue_unavailability` has no "lifted" state today and the spec for SCRUM-105 says rows are
  never edited. The block row is deleted; the flags it raised go with it (`venue_booking_flags.unavailability_id` is
  `on delete cascade`), so the booking stops showing as affected and approving it is allowed again. What happened is kept in
  `activity_log` (`venue_unavailability_lifted`) and in the notifications. **[PROPOSED]** The alternative, a `lifted_at`
  column that every reader must filter, was rejected because the overlap checks of SCRUM-105 would all need changing.
- **Only Venue Staff.** `lift_venue_unavailability(p_venue_id, p_block_id)` is a `security definer` function that checks the
  role itself (42501), as `mark_venue_unavailable` does. Nobody can delete from the table directly (SCRUM-105 revoked it).
  **[DECIDED]**
- **A block of another venue is not found.** The block must belong to the venue in the path, otherwise `P0002` (404). **[DECIDED]**
- **Who is told.** For every still-open `venue_unavailable` flag of the block whose booking has not ended, the event's
  **assigned coordinator** (the rule of SCRUM-106, not `requested_by`) gets one `venue_block_lifted` notification, linked to
  the booking. A flag already resolved (the booking was replaced or closed) tells nobody. An event with no assigned
  coordinator tells nobody. Nobody else is notified. **[DECIDED]**
- **Another block may still apply.** If the same booking is still flagged by a different block, the message says so, so a
  coordinator is not told the problem is gone when it is not. **[PROPOSED]**
- **Same transaction.** The notifications, the audit row and the delete happen in one function call, so a lift is never half
  done (the rule of ADR 0002). **[DECIDED]**
- **Past blocks.** A block that has already ended can be lifted too; it changes nothing for anyone and tells nobody (its
  bookings are past). The venue page lists only upcoming blocks, so the button is only shown for those. **[PROPOSED]**
- **Route.** `POST /venues/:id/unavailability/:blockId/lift`, answering `200 { lifted: true, notifiedCoordinators }`. POST
  rather than DELETE keeps CORS as it is. A malformed id is a 404. **[PROPOSED]**
- **Screen.** On the venue page, each block in "Unavailable periods" gets a **Lift block** button for Venue Staff only, which
  asks for confirmation ("Lift this block? Coordinators with affected bookings will be told.") before calling the route, then
  shows a toast and refreshes. **[PROPOSED]**
- **Notification display.** `venue_block_lifted` is added to `NOTIFICATION_TYPES` and shown with an icon and a label, never
  colour alone. **[DECIDED]**

## Scenarios

### 185-S2 (AC2) Venue Staff lift a block

- **Given** a venue with an upcoming block, and two bookings of that venue flagged by it, each for an event with an assigned
  coordinator
- **When** a Venue Staff member lifts the block
- **Then** the block is gone from the venue's unavailable periods, new requests for that period are accepted again, both
  bookings are no longer flagged, each assigned coordinator has one new `venue_block_lifted` notification linked to their
  booking, and `activity_log` has a `venue_unavailability_lifted` row naming the venue and the period.

### 185-S2b (AC2) A block with nothing flagged

- **Given** a block that flagged no bookings
- **When** Venue Staff lift it
- **Then** it is gone, no notification is written, and the answer says no coordinators were notified.

### 185-S2c (AC2) Only Venue Staff may lift

- **Given** a coordinator, an organiser, a Lead, Technical Support Staff, a Safety Officer, an attendee, or nobody signed in
- **When** they try to lift a block
- **Then** they are refused (403, or 401 when not signed in), the block is still there, and nobody is notified.

### 185-S2d (AC2) The block must exist and belong to the venue

- **Given** a block id that does not exist, is malformed, or belongs to another venue
- **When** Venue Staff lift it through this venue
- **Then** the answer is 404 and no block is removed.

### 185-S2e (AC2) Only open flags tell anyone

- **Given** a block whose flag on one booking was already resolved (the booking was replaced) and whose flag on another is open
- **When** Venue Staff lift the block
- **Then** only the coordinator of the open flag is notified.

### 185-S2f (AC2) Still flagged by another block

- **Given** a booking flagged by two overlapping blocks
- **When** Venue Staff lift one of them
- **Then** its coordinator is notified, the message says the booking is still affected by another unavailable period, and the
  booking is still flagged by the other block.

## Out of scope

AC1, AC3 and AC4 of SCRUM-185 (see above). Editing a block (changing its period or reason) is not part of this story.
