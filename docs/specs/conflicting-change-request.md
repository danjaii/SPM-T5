# Hold a Conflicting Change Request While One Is Pending: Final User Story

User story for **Hold a Conflicting Change Request While One Is Pending** (ConnectSphere, IS212), compiled 2026-10-30.

- Scenario numbers are the test IDs: `176-S2` means SCRUM-176, Scenario 2.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-176 | Hold a Conflicting Change Request While One Is Pending | SCRUM-66 (submit a change request, `docs/specs/event-change-request.md`, migration 15), SCRUM-67 (review a change request, `docs/specs/review-change-request.md`), SCRUM-174 (pending requests close when the event is cancelled or completed) |

## Why

The customer said in the Week 9 Q&A that "active change requests should be processed by the Coordinator before additional major
conflicting change requests are submitted." Before this story, an organiser could send "move it to Friday" and then, before the
coordinator answered, "move it to Monday". Both sat pending, and the coordinator could approve both, leaving the event with
whichever was approved last.

## Implementation decisions (2026-10-30)

1. **[DECIDED] What conflicts.** A new request conflicts with a pending one when both change the same thing. The things are:
   expected attendance; date and time; venue requirements; equipment requirements. **Start and end time count as one thing,
   "date and time"**, because moving an event changes both, so a pending start-time change and a new end-time change clash.
   A request that changes only other things is accepted (AC2). This follows the customer's words "major conflicting": a
   second request is not refused just because another is waiting.
2. **[DECIDED] One shared rule.** `changeRequestConflicts()` in `packages/shared/src/eventChangeRequest.ts` says which things a
   new request shares with the pending ones, so the form and event-service agree. A seeded request that holds only the new
   value (`{ "expected_attendance": 220 }`) still names its field, so it counts too.
3. **[DECIDED] Checked twice.** `POST /events/:id/change-requests` refuses a conflicting request with 409 `CONFLICTING_REQUEST`,
   naming what is waiting (AC1). Migration 67's trigger refuses the same insert in the database (SQLSTATE `CS176`), so two
   submissions sent at the same moment cannot both get through; the route answers that refusal the same way.
4. **[DECIDED] The organiser is not left stuck.** The refusal says to ask their coordinator. The customer said in the Week 9 Q&A
   that withdrawals must be requested through the Event Coordinator, so there is no withdraw button: the coordinator rejects the
   waiting request (SCRUM-67), and the organiser can then send the new one (AC3).
5. **[DECIDED] The form warns first (AC4).** The event page already loads the event's change requests (SCRUM-66/AC7). The form
   uses the shared rule on the pending ones to list what is waiting, before the organiser types anything.

## Considered and left out

- **Organisers withdrawing their own pending request**: see decision 4.
- **Refusing any second request while one is pending**: stricter than the customer asked ("conflicting").
- **Closing a pending request when its event is cancelled or completed**: built in SCRUM-174 (AC5).

## SCRUM-176 Hold a Conflicting Change Request While One Is Pending

**User story:** As an Event Coordinator, I want an organiser to be stopped from submitting a change request that clashes with
one I have not processed yet, so that I never approve two contradicting changes to the same event.

### Acceptance criteria

1. **AC1** Given my event has a pending change request that changes a field (e.g. the date), when I submit another change
   request that changes any of the same fields, then it is refused with a message saying which field already has a request
   waiting and that I can ask my coordinator about it, and nothing is saved.
2. **AC2** Given my event has a pending change request, when I submit a change request that changes only other fields, then it
   is accepted as usual.
3. **AC3** Given my earlier change request was approved or rejected, when I submit a new request for the same field, then it is
   accepted.
4. **AC4** Given I open the change request form while a request is pending, when the form loads, then it tells me which fields
   already have a request waiting.

### Scenarios

| ID | AC | Given | When | Then |
| --- | --- | --- | --- | --- |
| 176-S1 | AC1 | Jason's event has a pending request to raise attendance | he asks to raise attendance again | 409 `CONFLICTING_REQUEST`, naming "expected attendance" and saying to ask his coordinator; nothing is saved |
| 176-S2 | AC1 | a pending request changes the start time | he asks to change only the end time | refused, naming "date and time" |
| 176-S3 | AC1 | a pending request changes attendance and venue requirements | he asks to change venue requirements and equipment requirements | refused, naming only "venue requirements" |
| 176-S4 | AC2 | a pending request changes attendance | he asks to change the date | accepted (201) |
| 176-S5 | AC3 | his attendance request was approved, and another was rejected | he asks to change attendance | accepted |
| 176-S6 | AC1 | a pending request changes attendance | two attendance requests arrive in the database at once, or one is inserted directly | the database refuses the one that conflicts (`CS176`); one pending request remains |
| 176-S7 | AC1 | another event of his has a pending attendance request | he asks to change this event's attendance | accepted: requests on different events never conflict |
| 176-S8 | AC4 | a pending request changes the start time and attendance | he opens the form | it says "Already waiting for your coordinator: expected attendance, date and time. A new request can't change these until your coordinator has decided." |
| 176-S9 | AC4 | no request is pending (only decided ones) | he opens the form | no waiting notice |
| 176-S10 | AC1 | the form is open | the server refuses as conflicting | the refusal is shown and the form keeps what he typed |
