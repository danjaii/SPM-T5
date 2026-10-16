# Review an Event Change Request: Final User Story

User story for **Review an Event Change Request** (ConnectSphere, IS212), compiled 2026-10-16.

- Scenario numbers are the test IDs: `67-S4` means SCRUM-67, Scenario 4. Jira lists the ACs without numbers; they are AC1 to
  AC8 here in Jira's order.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-67 | [Event Change Request] Review an Event Change Request | SCRUM-66 (organisers submit change requests, `docs/specs/event-change-request.md`), SCRUM-111 (`update_event_details()`), SCRUM-112 (affected arrangements), SCRUM-113 (sending them back for review) |

## Implementation decisions (2026-10-16)

- **Who reviews.** Only the event's current assigned Event Coordinator approves or rejects (AC7). Other coordinators may still
  see the list, as SCRUM-66 allows. **[DECIDED]**
- **Approving is an edit.** The requested fields (expected attendance, start, end, venue and equipment requirements; seeded
  requests also hold accessibility needs) are all SCRUM-111 fields, so approving saves them through `update_event_details()`:
  it is recorded in the change history as the coordinator's change, and an important change sends the affected venue
  bookings and equipment requests back for review, returning a Confirmed event to Planning (SCRUM-113). The confirmation box
  lists those arrangements before the coordinator confirms (AC6, SCRUM-112). **[DECIDED]**
- **One step.** `review_change_request()` (migration 42, security definer) marks the request and, for an approval, applies it in
  the same transaction, so a request is never marked approved without the event changing, or the other way round. It checks
  that the values it applies are exactly the request's. **[DECIDED]**
- **Outdated requests are not applied.** A request records each field's value when it was made ("from"). If the event has
  changed since, the review shows "changed since the request" for that field and approval is refused (`OUTDATED`); the
  coordinator rejects it with a reason, and the organiser can ask again. **[DECIDED]**
- **Rejecting needs a reason** (at most 2000 characters), which the organiser sees beside the Rejected status (SCRUM-66 already
  shows it). The event is not touched (AC5). **[DECIDED]**
- **Older shapes.** Requests made in the app hold `{ from, to }` per field. Seeded ones hold only the new value: it is read as
  "from the event's current value". A field the system cannot apply (for example `registration_capacity`) is shown, and the
  request can only be rejected (`UNSUPPORTED`). **[DECIDED]**
- **Already decided (AC8).** An approved or rejected request shows its outcome and no actions; the service and the function
  refuse a second decision (`ALREADY_REVIEWED`). **[DECIDED]**
- **Fix to SCRUM-66.** Its route did not read `events.venue_requirements` (added later, by SCRUM-111), so a venue requirements
  change was recorded "from nothing". It now reads it, so the request matches the event when reviewed. **[DECIDED]**
- **Not in this story:** notifying the organiser (SCRUM-47), editing a request before approving it.

---

## SCRUM-67 Review an Event Change Request

**User story.** As an Event Coordinator, I want to review change requests on events assigned to me, so that changes that can be
accommodated are applied to the event.

### Acceptance criteria

*AC1 — Awaiting review.* Given that an event assigned to me has a pending change request, when I open the event, I should see
that a change request is awaiting my review.

*AC2 — Requested and current values.* Given that I open a pending change request, when I view it, I should see each requested
change together with the current value.

*AC3 — Approve.* Given that I am reviewing a pending change request, when I approve it, the system should update the event to
the requested change and mark the request as approved.

*AC4 — Reason for rejecting.* Given that I am rejecting a change request, when I confirm the rejection, I should be able to
provide a reason.

*AC5 — Reject.* Given that I am reviewing a pending change request, when I reject it, the system should leave the event's
details unchanged and mark the request as rejected.

*AC6 — Confirm first.* Given that I am reviewing a pending change request, when I choose to approve or reject it, the system
should ask me to confirm my decision before applying it, and if I cancel, the request should remain pending and the event
unchanged.

*AC7 — Only my events.* Given that an event is not assigned to me, when I attempt to review its change requests, the system
should not allow it.

*AC8 — Decided once.* Given that a change request has already been approved or rejected, when I open it, I should not be able to
approve or reject it again.

### Scenarios

| ID | AC | Scenario | Expected |
| --- | --- | --- | --- |
| 67-S1 | AC1 | The assigned coordinator opens an event with a pending request | "A change request is awaiting your review", with a link to review it |
| 67-S2 | AC2 | They open the request | each field: label, current value, requested value; a field changed since the request is marked |
| 67-S3 | AC3 | Approve, confirmed | the event has the requested values, recorded in its change history; the request is approved (who, when) |
| 67-S4 | AC3 | Approve an important change that affects arrangements | the confirmation lists them; approving sends them back for review |
| 67-S5 | AC3 | The event changed since the request, or a field cannot be applied | approval refused (`OUTDATED`, `UNSUPPORTED`); nothing changes |
| 67-S6 | AC4 | Reject with no reason | refused: a reason is required |
| 67-S7 | AC5 | Reject with a reason, confirmed | the request is rejected with the reason; the event is unchanged |
| 67-S8 | AC6 | Cancel the confirmation | nothing sent; the request stays pending |
| 67-S9 | AC7 | Another coordinator, the organiser, anyone else | refused (403); the event and request unchanged |
| 67-S10 | AC8 | An approved or rejected request | its outcome shown, no actions; a second decision is refused (`ALREADY_REVIEWED`) |
| 67-S11 | AC3 | A finished event | approval refused (`EVENT_LOCKED`) |

### Test map

- Shared rules (reading a request against the event): `packages/shared/tests/`.
- Database (event-service `tests/integration`): 67-S3 to S7, S9 to S11.
- event-service unit: the routes. Web: the event page banner and list, and the review page.
