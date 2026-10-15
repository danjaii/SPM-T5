# Change or Cancel One Venue Booking: Final User Story

User story for **Change or Cancel One Venue Booking** (ConnectSphere, IS212), compiled 2026-10-15.

- Scenario numbers are the test IDs: `102-S4` means SCRUM-102, Scenario 4.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-102 | Change or Cancel One Venue Booking | SCRUM-98 (several venue bookings per event, `docs/specs/multiple-venue-bookings.md`), SCRUM-32 and SCRUM-35 (submit and withdraw, `docs/specs/venue-booking-request.md`), SCRUM-38 and SCRUM-39 (venue staff approve and reject) |

Customer answers this story follows (week 9 clarifications):

- "Each venue is checked and managed independently for suitability, availability, and approval. The co-ordinator will make
  relevant changes based on the checked results and resubmitted for approval only on the affected venue." So a changed venue
  booking goes back to venue staff, and only that one.
- "When approving/rejecting or making major changes/cancellations, reasons and notes should be recorded and communicated via
  notifications to relevant users." So a cancellation records a reason. Notifications are not built yet (notification-service
  only serves `/health`), so the reason is stored for when they are.
- "Every required venue booking for the event must be independently approved/confirmed before the overall event is confirmed"
  (O-28). So cancelling an event's last venue booking leaves the event as it is (AC5); it cannot be confirmed until it has
  approved venue bookings again.
- "Any post-confirmation material change (date, time, attendance, venue, layout, or equipment) requires re-reviewing affected
  arrangements and undergoing the safety check again before re-confirmation." That is SCRUM-111 to 113, so this story does not
  change venue bookings of a Confirmed event.

## Implementation decisions (2026-10-15)

These override `docs/specs/venue-booking-request.md` where they conflict.

- **Changing a venue booking edits it in place and sends it back to Pending.** The coordinator can change its date, start,
  end, expected attendance and venue requirements, not its venue (a different venue is a new venue booking, SCRUM-98). The
  same row gets the new values and becomes PENDING again, with its earlier decision (who approved it, when, notes) cleared, so
  venue staff decide on it afresh. If it was APPROVED, it stops holding the old period straight away. **[DECIDED]**
- **Only that venue booking is checked again (AC1)**, with the same rules as a new one: the shared validation, the same venue
  overlapping another of this event's venue bookings (`DUPLICATE_VENUE`), another event holding the venue (`SLOT_CONFLICT`),
  the repeat of a rejected slot (`REPEAT_OF_REJECTED`) and the capacity warning (`exceedsCapacity`, never a refusal). The
  booking never clashes with itself. Changing nothing at all is refused with `NO_CHANGES`, so a venue booking is not sent back
  to venue staff for no reason. **[DECIDED]**
- **Only PENDING and APPROVED venue bookings can be changed or cancelled.** A rejected one is amended instead (SCRUM-60); a
  withdrawn or cancelled one is finished. Anything else is `NOT_ACTIVE`. **[DECIDED]**
- **One Cancel for both PENDING and APPROVED.** Cancelling sets the new API status `CANCELLED` (the database's existing
  `cancelled` value, which nothing used yet). It stops holding the venue. On the event page this replaces Withdraw; SCRUM-35's
  Withdraw stays on the venue booking's own page and in the API, unchanged. **[DECIDED]**
- **A reason is required to cancel**, 1 to 500 characters once trimmed (the same rule as a rejection reason, 39-S2). It is
  stored with who cancelled and when, and shown in the event's list of venue bookings. **[DECIDED]**
- **No "cancel all" (AC3 dropped 2026-10-15).** The customer's change note asks that cancelling one venue booking "should
  not automatically remove the other venue bookings unless this is explicitly required"; it does not ask for a way to cancel
  them all at once. A coordinator can still cancel each one, each deliberately, so the team dropped AC3 to keep the story
  small. The other ACs keep their numbers. **[DECIDED]**
- **Confirm first (AC4).** The page asks before cancelling; going back from that question sends nothing. **[DECIDED]**
- **The event is never cancelled by this (AC5)**, even when its last venue booking is cancelled. Its status does not change.
  **[DECIDED]**
- **Who and when (AC6).** Only the event's current assigned coordinator, and only while the event is Approved, Planning or
  Awaiting arrangements (the statuses that can request a venue, DR9). Another coordinator, any other role: 403. A Confirmed or
  closed event: `EVENT_NOT_ELIGIBLE`. A coordinator who took over the event (SCRUM-79 reassignment) can change and cancel venue
  bookings their predecessor made. **[DECIDED]**
- **Done in the database, in one step.** The database only lets coordinators change a venue booking's status (07, column
  grants), on purpose. So changing and cancelling go through two security definer functions, `change_venue_booking()` and
  `cancel_venue_booking()` (migration 29), which check the caller, the event and the venue booking and then update, like
  `reserve_equipment()` (12). The overlap constraint (06) still applies to the changed row. **[DECIDED]**
- **Cancelled venue bookings are listed.** The event's list (SCRUM-98) and the coordinator's list (SCRUM-33) now show them as
  Cancelled, with the reason, instead of leaving them out. Older `cancelled` rows from the seed data show the same way, with no
  reason. **[DECIDED]**
- **Cancelling releases the venue booking's equipment (AC7).** An equipment request can point at an approved venue booking
  (SCRUM-86) and copies its start and end time. When that venue booking is cancelled, every equipment
  request linked to it that is not already released becomes `cancelled` in the same step, so either both happen or neither
  does. `cancelled` does not hold units (18-S8 counts only `approved` and `reserved`), so Arranged equipment is free for other
  events at once. There is no choice to make, so the confirmation says it as a statement, lists the equipment, and has one
  button, "Cancel venue booking and release equipment" (just "Cancel venue booking" when nothing is linked), plus Go back
  (AC4). It is in the confirmation, not a page afterwards, so the equipment cannot be left held if the coordinator leaves
  between two steps. The event's equipment list shows a released request as **Released**, with the venue booking's
  cancellation reason, instead of hiding it (today a `cancelled` request is hidden). Customer: "Equipment reservations match
  the specific session timing/venue where required." **[DECIDED]**
- **Changing moves the venue booking's equipment and sends it back for review (AC8).** When a venue booking's date or time
  changes, each equipment request linked to it (not released) takes the new start and end time and goes back to Submitted
  (`requested`, with any reserved quantity cleared), in the same step, so Technical Support check it again: the stock may not
  be free at the new time. A change to only the attendance or requirements leaves the equipment as it is. The change form says
  this as a statement and lists the equipment. This matches SCRUM-88 AC2 (an edited request goes back to Submitted). **[DECIDED]**
- **Equipment requests not linked to a venue booking** (older rows, `venue_booking_id` empty) are never touched. **[DECIDED]**
- **API.** `PATCH /venue-bookings/:id` (change; body like a new request without `eventId` and `venueId`) and `POST
  /venue-bookings/:id/cancel` (body `{ reason }`). Change returns the venue booking with `exceedsCapacity`; cancel returns the
  cancelled venue booking with who cancelled it, when and why. **[DECIDED]**
- **Migration 30** (29 is SCRUM-73's): adds `cancelled_by`, `cancelled_at` and `cancellation_reason` to `venue_bookings`, and the two functions,
  which also update `equipment_reservations` (AC7, AC8). Affects venue-service and equipment-service, and the shared equipment
  status labels (`cancelled` reads as Released). SCRUM-87's open branch also changes equipment statuses, so this is flagged in
  the PR. **[DECIDED]**

---

## SCRUM-102 Change or Cancel One Venue Booking

**User story.** As an Event Coordinator, I want to change or cancel one venue booking for an event without affecting its other
venue bookings, so that one space's arrangements can be adjusted while the rest of the event stays in place.

### Acceptance criteria

*AC1.* Given that an event has more than one venue booking, when I change the date, time or requirements of one booking, the
system should check only that booking again and leave the others unchanged.

*AC2.* Given that an event has more than one venue booking, when I cancel one of them, the system should cancel only that
booking and leave the others unchanged.

*AC3.* *(Dropped 2026-10-15: no "cancel all". See Implementation decisions.)*

*AC4.* Given that I choose to cancel a venue booking, when I make the choice, the system should ask me to confirm
before cancelling, and if I cancel the confirmation, all bookings should remain unchanged.

*AC5.* Given that I cancel the event's only remaining venue booking, when the cancellation is confirmed, the event itself
should not be cancelled.

*AC6.* Given that an event is not assigned to me, when I attempt to change or cancel its venue bookings, the system should not
allow it.

*AC7.* Given that a venue booking has equipment requests, when I cancel it, the system should show me the equipment that
will be released, and on confirming, release that equipment together with the venue booking, so it is free for other events.

*AC8.* Given that a venue booking has equipment requests, when I change its date or time, the system should move that
equipment to the new date and time and send it back to Technical Support Staff for review.

(AC7 and AC8 added 2026-10-15; add them to Jira too.)

### Scenarios

| ID | AC | Scenario | Expected |
| --- | --- | --- | --- |
| 102-S1 | AC1 | Change the date and times of one of two venue bookings | 200; it has the new period and is PENDING; the other is unchanged |
| 102-S2 | AC1 | Change an APPROVED venue booking | it becomes PENDING, its earlier decision cleared, and it shows in the venue staff queue again |
| 102-S3 | AC1 | Change only the expected attendance or the venue requirements | stored on that venue booking; PENDING again |
| 102-S4 | AC1 | Change to a period another event holds at that venue | 409 `SLOT_CONFLICT`; nothing changes |
| 102-S5 | AC1 | Change to a period overlapping another of this event's venue bookings at the same venue | 409 `DUPLICATE_VENUE`; nothing changes |
| 102-S6 | AC1 | Change to a period overlapping its own current period (for example 9–12 to 10–13) | 200: it does not clash with itself |
| 102-S7 | AC1 | Change to more people than the venue holds | 200 with `exceedsCapacity: true` (a warning) |
| 102-S8 | AC1 | Invalid values (end before start, start in the past, attendance 0) | 422 with field errors; nothing changes |
| 102-S9 | AC1 | Nothing actually changed | 409 `NO_CHANGES` |
| 102-S10 | AC1 | Change to the exact slot of a rejected venue booking of this event at that venue | 409 `REPEAT_OF_REJECTED` |
| 102-S11 | AC1, AC2 | Change or cancel a REJECTED, WITHDRAWN or CANCELLED venue booking | 409 `NOT_ACTIVE` |
| 102-S12 | AC2 | Cancel one of two venue bookings (PENDING, then APPROVED) with a reason | it is CANCELLED with the reason, who and when; the other is unchanged |
| 102-S13 | AC2 | Cancel with no reason, only spaces, or 501 characters | 422 on `reason`; nothing changes |
| 102-S14 | AC2 | After cancelling, another request for that venue and period | 201: the cancelled one no longer holds it |
| 102-S15 to S17 | AC3 | *(dropped with AC3)* | |
| 102-S18 | AC4 | Press Cancel on a venue booking | a confirmation with a reason box appears; nothing is sent yet |
| 102-S19 | AC4 | Go back from the confirmation | nothing is sent; every venue booking is as it was |
| 102-S20 | AC5 | Cancel the event's only remaining venue booking | the event's status is unchanged |
| 102-S21 | AC6 | Another coordinator changes, cancels or cancels all | 403; nothing changes |
| 102-S22 | AC6 | Organiser, venue staff, technical support, attendee, no role | 403; no session: 401 |
| 102-S23 | AC6 | The event is Confirmed, Completed, Cancelled or still Submitted | 409 `EVENT_NOT_ELIGIBLE` |
| 102-S24 | AC6 | The coordinator who took over the event cancels a venue booking their predecessor made | allowed |
| 102-S25 | AC2 | The event's list of venue bookings | a cancelled one shows Cancelled with its reason |
| 102-S26 | AC1 | The event page | each PENDING or APPROVED venue booking has Change and Cancel; others have neither |
| 102-S27 | AC1 | The change form | pre-filled with that venue booking's date, times, attendance and requirements; the venue is shown, not editable |
| 102-S28 | AC7 | Cancel a venue booking with Arranged and Submitted equipment requests | both become Released in the same step; the Arranged units are available to other events again |
| 102-S29 | AC7 | The cancel confirmation for a venue booking with linked equipment | lists the equipment as a statement; the button reads "Cancel venue booking and release equipment"; with none linked it reads "Cancel venue booking" |
| 102-S30 | AC7 | *(dropped with AC3)* | |
| 102-S31 | AC7 | The event's equipment list after a release | the request shows Released, with the venue booking's cancellation reason |
| 102-S32 | AC7 | Cancelling fails (for example the event is not eligible) | neither the venue booking nor its equipment changes |
| 102-S33 | AC8 | Change a venue booking's time when it has an Arranged equipment request | the request takes the new start and end, becomes Submitted, and no longer holds units at the old time |
| 102-S34 | AC8 | Change only the attendance or requirements | the equipment requests are unchanged |
| 102-S35 | AC8 | The change form for a venue booking with linked equipment | says, as a statement, that the listed equipment will move to the new time and go back to Technical Support |

### Test map

- Shared validation (cancel reason, change input): `packages/shared/tests/`.
- Service rules (unit, fakes): 102-S1 to S14, S20 to S24. Database functions and the overlap constraint (integration, CI only):
  102-S2, S4, S6, S12, S14, S21, S23.
- Equipment (database functions, integration): 102-S28, S32, S33, S34. Equipment list label: 102-S31.
- Routes and lists: 102-S25. Web: 102-S18, S19, S26, S27, S29, S35.

### Questions for the customer (none block the build)

1. Is releasing a cancelled venue booking's equipment, and sending a moved venue booking's equipment back to Technical
   Support, what you expect? (AC7, AC8: decided by the team.)
2. Should the organiser see that a venue booking was cancelled, and the reason (once notifications exist)?
