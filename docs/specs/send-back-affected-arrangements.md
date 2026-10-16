# Send Back Affected Arrangements: Final User Story

User story for **Review arrangements affected by event changes** (ConnectSphere, IS212), compiled 2026-10-16.

- Scenario numbers are the test IDs: `113-S4` means SCRUM-113, Scenario 4.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-113 | [Event Information Management] Review Arrangements Affected by Event Changes | SCRUM-112 (which arrangements a change affects, `docs/specs/important-change-impact.md`), SCRUM-111 (`update_event_details()`), SCRUM-37 to 39 (Venue Staff queue), SCRUM-87 (Technical Support Staff review) |

What the customer documents say:

- Brief, "Impact of Event Changes": "Significant changes ... may require existing arrangements to be reviewed again."
- Brief, "Event Capacity Management": "A significant attendance change may require the suitability of an existing venue booking
  to be reviewed."
- Week 9: each venue is checked again independently; an event that is no longer fully arranged is not Confirmed.

## Implementation decisions (2026-10-16)

- **No new status.** Sending back reuses the review flows staff already have: a venue booking returns to Pending (Venue Staff
  queue, SCRUM-37), an equipment request returns to Submitted (Technical Support Staff review, SCRUM-87). **[DECIDED]**
- **Which arrangements.** Exactly the ones SCRUM-112's warning listed (`affectedArrangements()`), and only when the coordinator
  confirms the change (Save anyway). A change with no warning sends nothing back (AC5). **[DECIDED]**
- **One step with the save.** `update_event_details()` (migration 39 replaces it) saves the event, its history row, and sends
  the listed arrangements back together, so a change is never saved without its arrangements being sent back. event-service
  passes the ids; the function only touches that event's own active ones (pending or approved venue bookings; Submitted, Under
  Review or Arranged equipment requests). **[DECIDED]**
- **What sending back does.**
  - Venue booking: status Pending, the earlier decision cleared (as SCRUM-102's change does). Pending still holds the venue
    (SCRUM-98 DR5), so nobody else can take it meanwhile (AC1).
  - Equipment request: status Submitted, the arranged units released, the earlier review cleared (as SCRUM-102 does). **[DECIDED]**
  - The venue booking's own numbers (attendance, requirements) are not changed: staff see the event's change beside them.
- **What changed (AC3).** Each one sent back stores the event's changes that caused it (field, old value, new value) and when.
  Staff read it from the venue booking or equipment request itself, so they need no access to the event's change history.
  If it is sent back again before anyone reviews it, the changes are merged: each field keeps its oldest "from" and newest "to".
  **[DECIDED]**
- **When the note goes.** Any later status change that is not a send-back (Venue Staff approve or reject, Technical Support
  Staff review, the coordinator changes or cancels it under SCRUM-102) clears it, so it never reappears on a later Pending.
  A trigger does this, so no existing function needs changing. **[DECIDED]**
- **Confirmed event (AC4).** A Confirmed event returns to Planning only when the change sent at least one arrangement back;
  the status change is recorded in the event's status history. **[DECIDED]**
- **Where it shows.** Venue Staff: the queue marks a sent-back venue booking, and its page lists what changed. Technical
  Support Staff: the equipment request's review page lists what changed. The coordinator's event page marks venue bookings and
  equipment requests waiting for review again. Each change shows its label, old and new value (category and room layout by
  name). **[DECIDED]**
- **Not in this story:** notifications to staff (SCRUM-46 and later), suggesting alternative venues (SCRUM-40).

---

## SCRUM-113 Review arrangements affected by event changes

**User story.** As Venue Staff or Technical Support Staff, I want arrangements affected by an important event change to come back
to me for review, with what changed, so that I can review them using the latest event information.

### Acceptance criteria

*AC1 — Send affected venue bookings for review.* Given I confirm an important change that affects a venue booking, when the
change is saved, then the venue booking returns to Pending for Venue Staff to review again, and it keeps holding its venue until
they decide.

*AC2 — Send affected equipment requests for review.* Given I confirm an important change that affects an equipment request,
when the change is saved, then the equipment request returns to Submitted for Technical Support Staff to review again.

*AC3 — Show what changed.* Given an arrangement has been sent back for review, when Venue Staff or Technical Support Staff view
it, then they can see which event information changed, with its old and new values.

*AC4 — Return a confirmed event to planning.* Given an event is Confirmed, when an important change is confirmed, then the event
returns to Planning, so it must be confirmed again once its arrangements are reviewed.

*AC5 — Do not send back unaffected arrangements.* Given an important change does not affect an existing arrangement, when the
change is confirmed, then that arrangement keeps its current status.

### Scenarios

| ID | AC | Scenario | Expected |
| --- | --- | --- | --- |
| 113-S1 | AC1 | Save anyway on a change that lists an approved venue booking | it is Pending, decision cleared, still holds its venue |
| 113-S2 | AC1 | A listed venue booking that is already Pending | stays Pending, now with what changed |
| 113-S3 | AC2 | A listed equipment request that is Arranged or Under Review | Submitted, units released, review cleared |
| 113-S4 | AC3 | A venue booking sent back | stores the changes (field, old, new) and when |
| 113-S5 | AC3 | Sent back twice before review | one note: each field's oldest "from", newest "to" |
| 113-S6 | AC3 | Venue Staff approve or reject it; SCRUM-102 change or cancel; Technical Support Staff review | the note is cleared |
| 113-S7 | AC3 | Venue Staff open the queue and the venue booking | marked "sent back", with each change: label, old → new |
| 113-S8 | AC3 | Technical Support Staff open the equipment request | each change: label, old → new |
| 113-S9 | AC4 | A Confirmed event, a change that sends something back | Planning, with a status history row |
| 113-S10 | AC4 | A Confirmed event, a change that sends nothing back | stays Confirmed |
| 113-S11 | AC5 | Arrangements the warning did not list | keep their status and get no note |
| 113-S12 | AC5 | Rejected, withdrawn, cancelled or released ones, or another event's, passed to the function | untouched |
| 113-S13 | AC1 | Another coordinator or a finished event | refused as in SCRUM-111; nothing sent back |
| 113-S14 | AC1 | The coordinator's event page | sent-back venue bookings and equipment requests marked as waiting for review again |

### Test map

- Database (event-service `tests/integration`): 113-S1 to S6, S9 to S13.
- event-service unit: the ids it sends on Save anyway, and none without the warning (S11).
- venue-service and equipment-service unit: the note in their views (S7, S8).
- Web: the queue, the venue booking page, the equipment review page and the event page (S7, S8, S14).
