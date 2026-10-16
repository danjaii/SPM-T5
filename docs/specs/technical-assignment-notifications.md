# Technical Assignment Notifications: Final User Story

User story for **Notification of on-site support assignment** (ConnectSphere, IS212), compiled 2026-10-16.

- Scenario numbers are the test IDs: `20-S4` means SCRUM-20, Scenario 4.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-20 | [Technical Staff Assignment] Notification of on-site support assignment | SCRUM-46 (notifications, `docs/specs/notifications.md`, ADR 0002), SCRUM-98 (an event's venue bookings), SCRUM-86 (picking one of the event's approved venue bookings) |

What the customer documents say:

- Brief, Technical Support Staff: they "may also be assigned to support an event on-site".
- Brief, Technical Staff Assignment: "Where required, suitable Technical Support Staff can be allocated to support an event
  according to availability and event requirements."
- Brief, problems today: "Technical Support Staff may receive insufficient notice about upcoming equipment or support
  requirements."
- Brief, Notifications: users are told about "confirmation, changes ... or cancellation".

## Implementation decisions (2026-10-16)

- **Assigning is built here, minimally.** Nothing in the app assigned Technical Support Staff before, so there was nothing to
  notify about. The event's **assigned Event Coordinator** assigns, changes and cancels on-site assignments (the seed data
  has coordinators as the ones who assigned). Choosing staff by availability and skills is not built. **[DECIDED]**
- **An assignment is for one venue booking.** The coordinator picks a Technical Support Staff member, one of the event's
  **approved** venue bookings (as SCRUM-86's equipment request form does), a start and end (filled in from the venue booking,
  editable, for example to arrive early for setup), and an optional note. The notification names that venue, so for a
  multi-venue event the technician knows which room to go to. **[DECIDED]**
- **Table.** `technical_staff_assignments` (migration 01, seeded, unused until now) gains `event_id`, `venue_booking_id`,
  `changed_at`, `acknowledged_at`, `cancelled_at`, `cancelled_by` and `cancellation_reason` (migration 41).
  `technical_support_request_id` becomes optional: a coordinator's assignment need not come from a support request. A seeded
  row still gets its `event_id` from its request. The same staff member cannot be assigned twice to one venue booking while
  both are active. **[DECIDED]**
- **Only functions write.** `assign_technical_staff()`, `change_technical_assignment()` and `cancel_technical_assignment()`
  are `security definer`: only the event's current coordinator, only for an event that is not completed, cancelled or rejected,
  only for Technical Support Staff, only one of the event's approved venue bookings, the end after the start. Direct
  INSERT, UPDATE and DELETE are revoked. Who may read: the event's coordinator, the assigned staff member and Technical Support
  Staff. **[DECIDED]**
- **Notifications are written with the change (ADR 0002).** A trigger on `technical_staff_assignments` writes the staff
  member's notification in the same transaction:

  | Change | Type | Says |
  | --- | --- | --- |
  | a new assignment | `technical_assignment_assigned` | the event name, the venue, the date and time (AC1) |
  | the venue booking, start or end changed | `technical_assignment_changed` | the updated venue, date and time (AC2) |
  | cancelled | `technical_assignment_cancelled` | which assignment, and the reason (AC3) |

  A change to the note only sends nothing. Times are Singapore time. Each row links to the event and to the assignment
  (`notifications.technical_staff_assignment_id`). Technical Support Staff can open the event of an assignment (migration 14's
  `event_has_technical_work()` now counts assignments). **[DECIDED]**
- **Acknowledging (AC4, AC5).** An "assigned" or "changed" notification has an **Acknowledge** button. Acknowledging marks
  the notification read and the assignment acknowledged (when), through `acknowledge_technical_assignment()`: only the
  notification's own recipient, only while the assignment is active, and only the notification about its current details
  (an older one, sent before a later change, is refused as out of date). Opening or marking read alone does not acknowledge.
  A change clears the acknowledgement, because the technician must confirm the new details. **[DECIDED]**
- **What the coordinator sees.** The event page lists its on-site assignments (staff, venue, date and time, note, status
  **Assigned**, **Acknowledged** or **Cancelled** with its reason), with Assign, Change and Cancel. **[DECIDED]**
- **Where it lives.** equipment-service (technical support) serves the assignment routes; notification-service serves
  Acknowledge; the rules shared by the form and the service are `packages/shared/src/technicalAssignment.ts`. **[DECIDED]**
- **Not in this story:** email or SMS (SCRUM-46 is in-app only), checking a technician's availability or skills, Technical
  Support Staff assigning themselves.

---

## SCRUM-20 Notification of on-site support assignment

**User story.** As a Technical Support Staff, I want to be notified when I am assigned to support an event on-site, so that I
know which events I need to attend.

### Acceptance criteria

*AC1 — Notified when assigned.* The technical support staff receives an in-system notification when assigned to support an
event on-site, including the event name, date and time, and venue.

*AC2 — Notified when the assignment changes.* The technical support staff receives an in-system notification, showing the
updated date, time, or venue, when an existing on-site assignment is changed.

*AC3 — Notified when the assignment is cancelled.* The technical support staff receives an in-system notification when an
existing on-site assignment is cancelled.

*AC4 — Acknowledge the notification.* The technical support staff can acknowledge the notification.

*AC5 — Assignment marked acknowledged.* The assignment is marked as acknowledged once the notification is acknowledged.

### Scenarios

| ID | AC | Scenario | Expected |
| --- | --- | --- | --- |
| 20-S1 | AC1 | The coordinator assigns a technician to a venue booking | the assignment is saved; the technician gets one notification with the event, venue, date and time |
| 20-S2 | AC1 | Another coordinator, a non-technician, another event's or an unapproved venue booking, end not after start, a finished event | refused; nothing saved, nobody notified |
| 20-S3 | AC1 | The same technician twice on one venue booking | refused |
| 20-S4 | AC2 | The times or the venue booking change | one notification with the updated venue, date and time; the acknowledgement is cleared |
| 20-S5 | AC2 | Only the note changes | saved; no notification |
| 20-S6 | AC3 | The coordinator cancels with a reason | the assignment is Cancelled; the technician is told, with the reason |
| 20-S7 | AC3 | Changing or cancelling a cancelled assignment | refused |
| 20-S8 | AC4 | The technician acknowledges an "assigned" notification | the notification is read; the assignment is acknowledged |
| 20-S9 | AC4 | Someone else's notification; a cancelled assignment; an out-of-date notification; a "cancelled" notification | refused |
| 20-S10 | AC5 | The coordinator views the event | each assignment shows Assigned, Acknowledged (when) or Cancelled (why) |
| 20-S11 | AC4 | The notification page | "assigned" and "changed" notifications show Acknowledge until acknowledged, then "Acknowledged" |
| 20-S12 | AC1 | The assign form | lists Technical Support Staff and the event's approved venue bookings, fills in the times from the venue booking, and checks the fields as the service does |

### Test map

- Shared rules (the form's fields, statuses): `packages/shared/tests/`.
- Database (equipment-service `tests/integration`): 20-S1 to S9.
- equipment-service unit: the routes. notification-service unit: Acknowledge and what an item says about it.
- Web: the event page section and form, and the notification page.
