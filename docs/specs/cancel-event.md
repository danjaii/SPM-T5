# Cancel an Event and Release Its Arrangements: Final User Story

User story for **Cancel an Event and Release Its Arrangements** (ConnectSphere, IS212), compiled 2026-10-30.

- Scenario numbers are the test IDs: `174-S3` means SCRUM-174, Scenario 3.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-174 | Cancel an Event and Release Its Arrangements | SCRUM-8 (change an event's status, `change_event_status()`, migration 04), SCRUM-102 (cancel one venue booking, `docs/specs/change-cancel-venue-booking.md`), SCRUM-20 (on-site technician assignments, migration 41), SCRUM-47 (notification producers, migration 44), SCRUM-66 and SCRUM-67 (change requests) |

## Why

The customer briefing lists "Cancelled events may continue to occupy venue or equipment reservations" among the problems the
system must fix, and its Cancellation Management section says "Related venue and equipment reservations should no longer remain
committed to a cancelled event". Before this story, setting an event to Cancelled changed only its status: its venue bookings
kept their venues, its equipment kept its units, an open change request stayed pending, and nobody was told.

What the customer said this story follows:

- The customer said in the Week 9 Q&A that "when approving/rejecting or making major changes/cancellations, reasons and notes
  should be recorded and communicated via notifications to relevant users." So a cancellation needs a reason, and it is sent
  to the organiser and the attendees.
- The customer said in the Week 9 Q&A that "if an event is cancelled or completed, any open pending change request for that
  event is rendered obsolete and should automatically become invalid/rejected or closed."
- The customer said in the Week 2 Q&A that "Organisers can request changes/cancellation at any point in time", and in the
  Week 9 Q&A that "modifications or withdrawals must be requested through the Coordinator." So the coordinator cancels; the
  organiser asks them to.

## Implementation decisions (2026-10-30)

1. **[DECIDED] Cancelling is a status change, not a new screen.** The assigned coordinator chooses Cancelled on the event's
   status panel, as before, and must now give a reason, as Rejected already needs one. `PATCH /events/:id/status` and
   `change_event_status()` both refuse a cancellation without a reason, so the rule holds however the status is changed.
2. **[DECIDED] The releases happen in the database, in the same transaction as the status change** (the ADR 0002 pattern).
   A trigger on `events` runs when the status becomes `cancelled` and:
   - cancels every active venue booking (`requested`, `tentative`, `approved`, `confirmed`), recording who, when and
     "The event was cancelled." as the reason, so the venues are free for other requests;
   - cancels every equipment request or reservation that is not already `rejected` or `cancelled`, including any with no
     venue booking, so the units are free for other events;
   - cancels every open on-site technician assignment (SCRUM-20) with the same reason; migration 41's trigger then tells each
     technician their assignment was cancelled.
   Because it is a trigger, the releases also happen if the status reaches `cancelled` another way, for example a direct
   update allowed by migration 14's column grant.
3. **[DECIDED] An open change request is closed by marking it `rejected`.** `change_request_status` has no "closed" value, and
   the customer accepted "invalid/rejected or closed". The review note says why: "Closed automatically: the event was
   cancelled." (or "completed."). This runs when an event becomes Completed too, which finishes the Week 9 rule.
4. **[DECIDED] Who is told.** The organiser, and every attendee whose registration is still active (`waitlisted` or
   `registered`, the same rule as `receivesEventUpdates()` in `packages/shared`), get an `event_cancelled` notification
   with the event's name and the reason. Withdrawn attendees are not told. The coordinator made the change, so they are not
   told either. Each technician is told by the existing assignment notification (decision 2). Written by migration 44's
   `notify_event_decision()`, which already announces approvals and rejections from `event_status_history`.
5. **[DECIDED] A cancelled event stays cancelled.** Its details were already locked (`update_event_details()` refuses a
   closed event, CS112). A new guard refuses any status change away from `cancelled` (CS174), and cancelling an event that
   is already completed, cancelled or rejected is refused too. Nobody in the customer's answers asked to re-open an event.

## Considered and left out

- **Guarded status transitions**, limiting which status can follow which. The customer said in the Week 2 Q&A that transition
  rules "are open to design assumptions; status progression is generally flexible for now". The one rule the customer did set,
  in the Week 9 Q&A, is that every venue and technical arrangement is approved and the safety check completed before an event
  is Confirmed, and that is already enforced (`events_safety_gate` and `is_ready_for_safety_check()`, migration 37). Logged in
  [scope-decisions.md](../scope-decisions.md).
- **Organisers cancelling directly**: they ask their coordinator (see Why).
- **Re-opening a cancelled event**: not asked for; see decision 5.
- **Email or SMS**: notifications are in-app only, as everywhere else.

## SCRUM-174 Cancel an Event and Release Its Arrangements

**User story:** As an Event Coordinator, I want to cancel an event with a reason so that its venues and equipment are freed for
other events and everyone involved knows why.

### Acceptance criteria

1. **AC1** Given I am the event's assigned Event Coordinator and the event is not completed, cancelled or rejected, when I
   cancel it without a reason, then it is refused and nothing changes.
2. **AC2** Given I cancel an event with a reason, when the cancellation is saved, then the event is Cancelled and the reason is
   recorded in its status history.
3. **AC3** Given the event has active venue bookings (pending, held or approved), when I cancel it, then every one of them is
   cancelled, so the venues are free for other requests.
4. **AC4** Given the event has equipment requests or reservations, when I cancel it, then they are released, so the units are
   free for other events.
5. **AC5** Given the event has a pending change request, when the event is cancelled or marked completed, then the change
   request is closed automatically.
6. **AC6** Given I cancel an event, when the cancellation is saved, then the Event Organiser and every attendee with an active
   registration receive a notification with the reason.
7. **AC7** Given an event is Cancelled, when anyone tries to change its status or details, then it is refused.
8. **AC8** Given I am not the event's assigned Event Coordinator, when I try to cancel it, then it is refused and nothing
   changes.

### Scenarios

| ID | AC | Given | When | Then |
| --- | --- | --- | --- | --- |
| 174-S1 | AC1 | Rachel is the assigned coordinator of a Planning event | she cancels it with no reason, or only spaces | 400 "A reason is required to cancel an event."; the event is still Planning |
| 174-S2 | AC2 | the same event | she cancels it with "Organiser withdrew the event" | the event is Cancelled, `cancelled_at` is set, and the status history row has the reason |
| 174-S3 | AC3 | the event has a pending, a held and an approved venue booking, and a rejected one | she cancels it | the first three are cancelled with who, when and "The event was cancelled."; the rejected one is untouched |
| 174-S4 | AC3 | another event wants the hall the cancelled event had approved, for the same time | its coordinator requests it | the request is accepted, because the hall is free |
| 174-S5 | AC4 | the event has equipment requested, arranged (`approved`, `reserved`) and one with no venue booking | she cancels it | every one is `cancelled`; the units count as free again |
| 174-S6 | AC4 | the event has an on-site technician assignment | she cancels it | the assignment is cancelled and the technician gets a "cancelled" notification |
| 174-S7 | AC5 | the event has a pending change request and an approved one | she cancels it | the pending one is `rejected` with "Closed automatically: the event was cancelled."; the approved one is untouched |
| 174-S8 | AC5 | an event has a pending change request | she marks it Completed | the request is `rejected` with "Closed automatically: the event was completed." |
| 174-S9 | AC6 | the event has an organiser, one registered and one waitlisted attendee, and one who withdrew | she cancels it | the organiser and the two active attendees each get one `event_cancelled` notification with the reason; the withdrawn attendee and Rachel get none |
| 174-S10 | AC7 | the event is Cancelled | Rachel tries to set it to Planning, or edit its details | refused (409); nothing changes |
| 174-S11 | AC1 | the event is Completed or Rejected | Rachel tries to cancel it | refused (409); nothing changes |
| 174-S12 | AC8 | Marcus is a coordinator but not this event's | he tries to cancel it | refused (403); nothing changes, and no booking is released |
| 174-S13 | AC1, AC2 | the coordinator is on the event page | they choose Cancelled | the reason box says it is required; Save is refused in the browser until a reason is typed |
