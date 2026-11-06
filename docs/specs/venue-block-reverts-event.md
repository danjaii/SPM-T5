# A Venue Block Returns a Confirmed Event to Planning: Final User Story

User story for the **AC1** part of SCRUM-185 ([Venue Unavailability] A Blocked Venue Reverts a Confirmed Event to Planning, and
a Block Can Be Lifted), ConnectSphere, IS212, compiled 2026-11-03.

- Scenario numbers are the test IDs: `185-S1` means SCRUM-185, the scenario for **AC1** (the other ACs have their own specs:
  AC2 in `venue-block-lifting.md`).
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.
- Written before the code. AC3 (the replacement-confirmed notice) and AC4 (the registration pause) are separate PRs.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-185 | [Venue Unavailability] A Blocked Venue Reverts a Confirmed Event to Planning, and a Block Can Be Lifted | SCRUM-105 (the block), SCRUM-106 (the flags and their notification), SCRUM-171 (Safety Reject and the automatic start), SCRUM-46 (notifications) |

## Why

When Venue Staff block a venue, the bookings it affects are flagged and their coordinators told (SCRUM-106), but an event that
was already **Confirmed** stays Confirmed. Its organiser and attendees keep reading "Confirmed" for an event whose venue
cannot be used. The customer said in the Week 9 Q&A that such an event must go back to Planning review, kept and not
cancelled (rows 44 and 51; an older Week 4 answer, row 8, said the status simply stays visible, and Week 9 is later). The team
decided on 2026-11-03 to follow Week 9. **[DECIDED]** This reverses the SCRUM-106 decision that "the booking and its event are
untouched", for Confirmed events only.

## Implementation decisions

- **Which events.** An event whose status is **Confirmed** and that has a venue booking the block flags (a holding, future
  booking whose padded period overlaps the block, SCRUM-106). Events in any other status are flagged exactly as before and
  their status is not touched, including Awaiting Arrangements: the customer's answer names Confirmed. **[DECIDED]**
- **Same transaction as the block.** A new `AFTER INSERT` trigger on `venue_booking_flags` (kind `venue_unavailable`) does it,
  so the block, the flags, the status change and the notification are one transaction. If any part fails the block is not saved.
  **[DECIDED]**
- **The event goes to Planning, "kept and not cancelled".** Only `events.status` changes (Confirmed to Planning). The event's
  data, its bookings and their statuses, its equipment reservations, registrations and comments are untouched. A row goes
  into `event_status_history` (`confirmed` to `planning`, `changed_by` the Venue Staff member, the reason naming the venue,
  the period and the reason label). **[DECIDED]**
- **Its Safety Approval is revoked**, the same as an important change does (SCRUM-100, migration 43): the approval was given
  for arrangements that no longer hold, so the event needs another safety check once its arrangements are confirmed again.
  Without this the Safety gate would let the event be re-confirmed on the old approval. **[PROPOSED]**
- **A guard exception.** `events_status_change_guard` lets only the assigned coordinator change an event's status. It gains one
  exception: Venue Staff may cause Confirmed to Planning. It is only reachable through this trigger, because Venue Staff have no
  update policy on `events`. **[DECIDED]**
- **One change per event.** A block that flags several bookings of the same event changes the status once (the second flag sees
  the event already in Planning), writes one history row and one notification. **[DECIDED]**
- **The coordinator is told.** One `event_returned_to_planning` notification for the event's assigned coordinator (not
  `requested_by`, the rule of SCRUM-106), linked to the event, titled "Event returned to Planning", with a message naming the
  event, the venue, the blocked period and the reason, and asking for a replacement venue. No assigned coordinator: nobody
  is told. It counts as needing action ("Action needed") because the coordinator has to arrange a replacement venue. The coordinator also still gets SCRUM-106's "Venue unavailable – alternative needed" notice for each flagged
  booking; the two say different things (what happened to the event, and what to do about the booking). **[PROPOSED]**
- **Nobody else is told yet.** The organiser and attendees are told only when replacement arrangements are confirmed (AC3, a
  separate PR), which is what the customer asked for (W9 r52). **[DECIDED]**
- **The block still needs an end time** (the schema requires one; W9 r42). Open-ended blocks (W9 r50) are not built. **[DECIDED]**
- **From Planning, the existing flow continues.** The coordinator replaces the booking (SCRUM-107); once the last arrangement is
  approved the event starts its safety check by itself (SCRUM-171) and can be Confirmed again after approval. Nothing here
  changes that.

## Scenarios

### 185-S1 (AC1) A block returns a Confirmed event to Planning

- **Given** a Confirmed event, with an Approved venue booking and a Safety Approval, whose coordinator is assigned
- **When** Venue Staff block that venue over the booking's period
- **Then** the event is in Planning, not cancelled, with its booking still Approved and its data unchanged; its Safety Approval is
  revoked; there is a status history row from Confirmed to Planning by the Venue Staff member; and its coordinator has one
  "Event returned to Planning" notification.

### 185-S1b Only a Confirmed event goes back

- **Given** events in Approved, Planning and Awaiting Arrangements with a booking the block flags
- **When** the block is saved
- **Then** their status is unchanged (they are flagged as before), and they get no "returned to Planning" notification.

### 185-S1c A block that touches nothing

- **Given** a Confirmed event whose booking the block does not overlap
- **When** the block is saved
- **Then** the event stays Confirmed.

### 185-S1d Several bookings of one event

- **Given** a Confirmed event with two bookings the block flags
- **When** the block is saved
- **Then** the event changes status once: one history row and one "returned to Planning" notification.

### 185-S1e No assigned coordinator

- **Given** a Confirmed event with no assigned coordinator
- **When** the block is saved
- **Then** the event still goes to Planning, and nobody is notified of it.

### 185-S1f The screen

- **Given** the event's page and the notifications page
- **When** the event has been returned to Planning
- **Then** the event shows its Planning status with the history row, and the coordinator's notifications list the new type with
  its own icon and label (never colour alone).

## Out of scope

AC3 (the organiser and attendees are told when replacements are confirmed), AC4 (registration may be paused or adjusted while
the event is back in Planning), lifting a block (AC2, `venue-block-lifting.md`; lifting does not move the event back to
Confirmed), open-ended blocks, and Awaiting Arrangements events.
