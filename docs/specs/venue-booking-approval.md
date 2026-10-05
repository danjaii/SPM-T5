# Venue Booking Approval: Final User Stories

Final user stories for the **Venue Booking Approval** core feature (ConnectSphere, IS212). Compiled 2026-09-29 from the revised cards. 

## How to use this file

- Each story has two parts. **Part A** is a code block in Jira wiki markup (`h2.`, `*bold*`, `* bullets`). Copy everything inside the block and paste it over the story's Description body in Jira. **Part B** is the implementation spec for Claude Code and is not for Jira.
- Scenario numbers in Part A are the test IDs. `32-S3` means SCRUM-32, Scenario 3. Part B refers to scenarios by these numbers.
- Part B cites shared rules as `DRn` (for example `DR2`). Those rules are in the appendix of this file.
- Markers: **[DECIDED]** you chose it on 2026-09-29. **[PROPOSED]** a default, confirm or change. **[CUSTOMER]** needs a customer answer; an interim rule is given.
- Amended stories: all 4 stories in this feature were rewritten. There are no unamended stories in this feature.
- Other files: SCRUM-32, 33, 35, 36, 59 and 60 (submit, track, withdraw, slot rule, amend, accept suggestion) are in `venue-booking-request-final.md`. SCRUM-29 is in `venue-catalogue-final.md`. SCRUM-36 (the shared slot rule) must be built before these stories. Several tests here are integration tests with those stories.
- Global build order across all three files: SCRUM-29, 36, 32, 37, 38 and 39, 40, 33 and 35, 60, 59. SCRUM-57 and 58 are not in this sprint.

## Story index

| Order | Key | Title | Jira priority / sprint today | Depends on | Jira field change |
| --- | --- | --- | --- | --- | --- |
| 1 | SCRUM-37 | Review Pending Request Queue | Medium, Sprint 1, Sprint 2 | SCRUM-15, SCRUM-32 | no change |
| 2 | SCRUM-38 | Approve Booking Request | Medium, Sprint 1, Sprint 2 | SCRUM-36, SCRUM-37 | no change |
| 3 | SCRUM-39 | Reject Booking Request With Reason | Medium, Sprint 1, Sprint 2 | SCRUM-36, SCRUM-37 | no change |
| 4 | SCRUM-40 | Suggest Alternative Arrangement | Low, Backlog | SCRUM-39 | **change to Priority Medium, Sprint 2** (SCRUM-59 depends on it) |

---

## SCRUM-37 Review Pending Request Queue

### Part A: Jira description

```text
h2. User Story

As Venue Staff, I want to see all pending venue booking requests with the event details attached, so that I can assess each request without contacting the Coordinator for information.

h2. Acceptance Criteria

*Scenario 1: Queue contents*

* Given three booking requests have status "Pending"
* When I open the pending requests queue
* Then all three are listed
* And each shows the venue, requested date and time, event name, expected attendance, venue requirements, accessibility needs, requesting Coordinator and submission time

*Scenario 2: Ordered first-come, first-served*

* Given pending requests were submitted at 09:00, 10:00 and 11:00
* When I open the pending requests queue
* Then they are listed with the earliest submission first
* And requests with the same submission time are listed in the order they were created

*Scenario 3: Decided and withdrawn requests leave the queue*

* Given a request has been approved, rejected or withdrawn
* When I open the pending requests queue
* Then that request is not listed

*Scenario 4: Amended requests*

* Given a Coordinator amended a rejected request and the new request is "Pending"
* When I open the pending requests queue
* Then the new request is listed at its own submission time
* And it shows that it amends an earlier request

*Scenario 5: Empty queue*

* Given no requests have status "Pending"
* When I open the pending requests queue
* Then the message "No pending booking requests." is shown rather than an error

*Scenario 6: Request detail*

* Given a request exists
* When I open it from the queue or by its address
* Then I see everything shown in the queue plus its status
* And for a decided request I also see who decided, when, and the rejection reason if there is one
* And if it amends an earlier request I see the link to that request

*Scenario 7: Access is restricted to Venue Staff*

* Given I am logged in as an Event Organiser, Event Coordinator, Technical Support Staff member or Attendee
* When I attempt to open the pending requests queue
* Then I am denied access

h2. Notes

Suitability is assessed against hard criteria (capacity, layout, accessibility, facilities, existing bookings), but Venue Staff retain approval authority and make the final call (Charles, G2). In Sprint 1 the system presents the information; it does not compute a verdict. That arrives with Venue Suitability Checking (core feature #11) in Sprint 3.

The event details shown are the values copied onto the request when it was submitted (SCRUM-32, Scenario 10), so Venue Staff assess what was actually requested.

Assumption (to confirm): all Venue Staff see all pending requests for all venues. Coordinators do not see this queue; they use SCRUM-33. There is no paging or filtering in this release.

h2. Depends On

* SCRUM-32 Submit Venue Booking Request
* SCRUM-15 Role-Based Access Control
```

### Part B: Agent implementation spec

Rules used: DR2, DR4, DR8, DR12, DR14.

**Queue row and detail fields.** venue name, requestedDate, start-end (SGT), snapshot (eventName, expectedAttendance, venueRequirements, accessibilityNeeds), requesting Coordinator display name, `submittedAt`. Detail adds status, decidedBy, decidedAt, rejectionReason, suggestion, `amendsRequestId`.

**Tests.**
- `37-S1`: 3 PENDING requests across two venues: 200, all three returned with all fields, values equal to the snapshot even after the event is edited.
- `37-S2`: order `submittedAt` ascending; two rows with equal `submittedAt` ordered by creation sequence (id ascending).
- `37-S3`: for APPROVED, REJECTED, WITHDRAWN rows, the queue excludes them.
- `37-S4`: an amendment R2 appears with its own `submittedAt` and an "amends R1" indicator.
- `37-S5`: empty queue returns 200 with an empty array; UI shows the empty text.
- `37-S6`: detail returns the fields above for PENDING and for decided requests; unknown id returns 404.
- `37-S7`: ORGANISER, COORDINATOR, TECHNICAL_SUPPORT, ATTENDEE get 403 on queue and detail; no session 401.

**Out of scope.** Pagination, filtering, suitability verdicts.

---

## SCRUM-38 Approve Booking Request

### Part A: Jira description

```text
h2. User Story

As Venue Staff, I want to approve a venue booking request, so that the venue is committed to that event and the Coordinator can continue planning.

h2. Acceptance Criteria

*Scenario 1: Approving a pending request*

* Given request R for "Orchid Hall" on 2026-11-14, 09:00-17:00 has status "Pending"
* When I approve request R and confirm
* Then the request status becomes "Approved"
* And the decision time and my identity are recorded against the request
* And the request no longer appears in the pending queue

*Scenario 2: A decided request cannot be approved again*

* Given request R has status "Approved", "Rejected" or "Withdrawn"
* When I open request R
* Then the approve action is unavailable
* And an approval attempted anyway is refused

*Scenario 3: Two decisions at the same moment*

* Given two Venue Staff members decide request R at the same moment
* When both are processed
* Then only one succeeds
* And the other is told the request is no longer pending

*Scenario 4: The event shows its approved venue*

* Given request R is approved for event "TechConf 2026"
* When a Coordinator views the event's venue booking
* Then it shows "Orchid Hall" on 2026-11-14, 09:00-17:00
* And the event's status and other details are unchanged

*Scenario 5: The venue becomes committed*

* Given request R for "Orchid Hall" on 2026-11-14, 09:00-17:00 has been approved
* When another Coordinator submits an overlapping request for "Orchid Hall"
* Then that request is refused

*Scenario 6: The outcome reaches the Coordinator*

* Given request R has been approved
* When the requesting Coordinator opens their venue bookings list
* Then request R is shown with status "Approved" and its decision date

*Scenario 7: No automatic suitability check*

* Given the event's expected attendance is higher than the venue's capacity
* When I approve the request
* Then the approval succeeds, as Venue Staff make the final decision

*Scenario 8: The requested time has already passed*

* Given the request's start time has already passed
* When I attempt to approve it
* Then the approval is refused and I am told the requested time is in the past

*Scenario 9: Only Venue Staff may approve*

* Given I am not Venue Staff, including the Coordinator who raised the request
* When I attempt to approve a request
* Then I am denied access

h2. Notes

Approval commits the venue for the requested period. Combined with SCRUM-36, an approved booking blocks any overlapping request for the same venue.

Decision (team, 2026-09-29): approving records the venue against the event but does not change the event's status. The customer said status changes are not automated, and both venue and technical support arrangements must be complete before the Coordinator confirms the event (Bryan, G1).

Assumption (to confirm): the screen asks Venue Staff to confirm before approving, as SCRUM-24 does for event decisions.

h2. Depends On

* SCRUM-37 Review Pending Request Queue
* SCRUM-36 Prevent Double-Held Venue Slot
```

### Part B: Agent implementation spec

Rules used: DR2, DR3, DR4, DR5, DR10, DR11, DR12, DR13.

**Transition.** PENDING to APPROVED only. Store `decidedBy`, `decidedAt`. The event's "venue booking" is derived from its APPROVED request (R10). Do not add a venue field to the event and do not change event status.

**Tests.**
- `38-S1`: 200; status APPROVED; decidedBy and decidedAt set; absent from the queue.
- `38-S2`: for APPROVED, REJECTED, WITHDRAWN: UI action hidden, API returns 409 `NOT_PENDING`.
- `38-S3`: two parallel decisions (approve and approve, and approve and reject): exactly one succeeds, the other returns 409 `NOT_PENDING`.
- `38-S4`: the booking query for the event returns Orchid Hall, 2026-11-14, 09:00-17:00; event status and every other event field are unchanged.
- `38-S5`: integration: an overlapping request from another event returns 409 `SLOT_CONFLICT`.
- `38-S6`: integration: the SCRUM-33 list shows APPROVED and decidedAt.
- `38-S7`: attendance above capacity: 200, APPROVED.
- `38-S8`: request start in the past: 409 `SLOT_IN_PAST`. [PROPOSED]
- `38-S9`: COORDINATOR (including the requester), ORGANISER, TECHNICAL_SUPPORT, ATTENDEE get 403; no session 401.

---

## SCRUM-39 Reject Booking Request With Reason

### Part A: Jira description

```text
h2. User Story

As Venue Staff, I want to reject a booking request and record why, so that the Coordinator understands the decision and can plan an alternative.

h2. Acceptance Criteria

*Scenario 1: Rejecting with a reason*

* Given request R has status "Pending"
* When I reject request R with the reason "Room under renovation until 2026-12-01" and confirm
* Then the request status becomes "Rejected"
* And the reason, decision time and my identity are recorded
* And the reason is visible to the requesting Coordinator
* And the request no longer appears in the pending queue

*Scenario 2: A reason is required*

* Given request R has status "Pending"
* When I attempt to reject request R with an empty reason, a reason of only spaces, or a reason longer than 500 characters
* Then a validation message is shown
* And the request remains "Pending"

*Scenario 3: Rejections are final*

* Given request R has status "Rejected"
* When I open request R
* Then no action is available to approve, edit or reopen it
* And an attempt anyway is refused
* And if the Coordinator amends it (SCRUM-60), a new request is created and R itself is not changed

*Scenario 4: The slot is released on rejection*

* Given request R held "Orchid Hall" on 2026-11-14, 09:00-17:00
* When I reject request R
* Then another Coordinator can successfully request "Orchid Hall" for that period

*Scenario 5: Only pending requests can be rejected*

* Given request R has status "Approved" or "Withdrawn", or another Venue Staff member decided it a moment ago
* When I attempt to reject request R
* Then the rejection is refused because the request is no longer pending
* And R keeps its current status

*Scenario 6: The event is not changed*

* Given request R is rejected
* When a Coordinator views the event
* Then the event's status and details are unchanged

*Scenario 7: Only Venue Staff may reject, and who sees the reason*

* Given I am not Venue Staff
* When I attempt to reject a request
* Then I am denied access
* And the reason is visible only to Venue Staff and the event's assigned Coordinator, not to the Event Organiser

h2. Notes

Customer confirmed rejections are final and must not be overridden or appealed (Charles, G2).

Assumption: a rejection reason is mandatory, 1 to 500 characters after trimming spaces. The customer left the field's necessity to implementation design (Rey, G2).

This story ships without the optional suggested alternative. SCRUM-40 adds it to the same reject action.

h2. Depends On

* SCRUM-37 Review Pending Request Queue
* SCRUM-36 Prevent Double-Held Venue Slot
```

### Part B: Agent implementation spec

Rules used: DR2, DR4, DR5, DR11, DR12, DR13.

**Transition.** PENDING to REJECTED only. Store `rejectionReason` (trimmed), `decidedBy`, `decidedAt`. Design the reject endpoint body so SCRUM-40 can add an optional `suggestion` without a breaking change.

**Tests.**
- `39-S1`: 200; status REJECTED; reason, decidedBy, decidedAt stored; SCRUM-33 detail returns the reason; absent from the queue.
- `39-S2`: reasons `""`, `"   "` and a 501-character string return 422; request stays PENDING. A 1-character and a 500-character reason succeed.
- `39-S3`: on a REJECTED request, approve or reject returns 409 `NOT_PENDING`; a SCRUM-60 amend leaves the original row unchanged.
- `39-S4`: integration with SCRUM-36: another event can request the same slot (201).
- `39-S5`: APPROVED and WITHDRAWN requests return 409 `NOT_PENDING`; two parallel decisions produce one success and one 409.
- `39-S6`: event status and event fields unchanged after rejection.
- `39-S7`: non-VENUE_STAFF get 403; no session 401; the ORGANISER gets 403 on the request detail and the reason.

---

## SCRUM-40 Suggest Alternative Arrangement

### Part A: Jira description

```text
h2. User Story

As Venue Staff, I want to suggest an alternative venue and time when rejecting a request, so that the Coordinator can adjust rather than restart the venue identification process.

h2. Acceptance Criteria

*Scenario 1: Rejecting with a suggestion*

* Given I am rejecting request R for "Orchid Hall" on 2026-11-14 with the reason "Room under renovation"
* When I select "Lotus Room" on 2026-11-15, 09:00-17:00 as a suggested alternative
* Then the suggestion is stored with the rejection
* And the requesting Coordinator can see the suggested venue, date and time

*Scenario 2: The suggestion is optional*

* Given I am rejecting request R
* When I submit the rejection with a reason but no suggested alternative
* Then the request is rejected successfully

*Scenario 3: A suggestion must be complete and valid*

* Given I am rejecting request R and adding a suggestion
* When the suggestion is missing the venue, date, start or end, or names a venue that does not exist, or the end is not after the start, or the start is in the past, or it is the same venue, date, start and end as R
* Then a validation message is shown
* And the rejection is not saved and R remains "Pending"

*Scenario 4: A suggestion does not hold the suggested slot*

* Given I rejected request R suggesting "Lotus Room" on 2026-11-15, 09:00-17:00
* When a different Coordinator requests "Lotus Room" for that period
* Then their request is created with status "Pending"

*Scenario 5: One suggestion, fixed once rejected*

* Given request R has been rejected
* When I try to add, change or remove its suggestion
* Then I am refused
* And a rejection carries at most one suggestion

*Scenario 6: Only Venue Staff may suggest*

* Given I am not Venue Staff
* When I attempt to reject a request with a suggestion
* Then I am denied access

h2. Notes

Paired with SCRUM-59, which uses the suggestion this story produces. Deliberately kept separate from SCRUM-39 so that rejection still ships if this is descoped.

Decision (team, 2026-09-29): this story moves from Backlog into Sprint 2 (Medium) because SCRUM-59 depends on it.

Assumption: a suggestion is one complete arrangement (venue, date, start, end). It is advice only. It is not checked for availability when made and does not hold the slot; availability is checked when someone requests or accepts it (SCRUM-36). Customer answer (Rey, G2): Venue Staff can suggest an alternative arrangement and the Coordinator adjusts the request.

h2. Depends On

* SCRUM-39 Reject Booking Request With Reason
```

### Part B: Agent implementation spec

Rules used: DR2, DR3, DR4, DR5, DR12.

**Jira fields to change by hand.** Priority Medium, Sprint 2 (currently Backlog, Low).

**Model.** Suggestion belongs to a REJECTED request: `venueId`, `date`, `startTime`, `endTime`, `usedAt` (null). Saved in the same transaction as the rejection; if the suggestion is invalid nothing is saved and the request stays PENDING.

**Tests.**
- `40-S1`: reject with reason and suggestion returns 200; SCRUM-33 detail returns the suggestion's venue name, date, start, end.
- `40-S2`: reject with reason only returns 200 (same as `39-S1`).
- `40-S3`: 422 and request still PENDING for each case: missing venue, date, start, end; unknown venue id; end not after start; start in the past; identical to R's venue, date, start and end.
- `40-S4`: suggestion on Lotus Room 2026-11-15 09:00-17:00; a different event can then request that slot (201 PENDING).
- `40-S5`: editing, adding to or deleting the suggestion of a rejected request returns 409; a second suggestion is not accepted.
- `40-S6`: non-VENUE_STAFF get 403; no session 401.

---

---

## Appendix: Shared implementation spec

**DR1 Roles.** EVENT_ORGANISER, EVENT_COORDINATOR, VENUE_STAFF, TECHNICAL_SUPPORT, ATTENDEE. One role per account in this release. [PROPOSED] (The customer said a person may hold different roles depending on organisation; deferred, so no self-approval case is needed.)

**DR2 Access denial.** Unauthenticated: 401. Authenticated but not permitted (wrong role, or not the event's assigned Coordinator): 403 with no protected data in the body. The UI also hides the control, but tests assert the server response. [PROPOSED]

**DR3 Time.** Asia/Singapore for input and display, stored as UTC. A booking is one calendar date plus a start and end time at minute precision. End must be after start. A booking cannot cross midnight or span days (the customer ruled multi-session events are separate events). The start must not be in the past. [PROPOSED]

**DR4 Booking request statuses.** PENDING, APPROVED, REJECTED, WITHDRAWN.
- PENDING can go to APPROVED, REJECTED or WITHDRAWN. Nothing else transitions. The other three are terminal.
- Amending a REJECTED request creates a new PENDING request with `amendsRequestId` pointing at the original. The original never changes.
- Fields: id, venueId, eventId, requestedDate, startTime, endTime, status, snapshot (DR8), submittedBy, submittedAt, decidedBy, decidedAt, rejectionReason, withdrawnBy, withdrawnAt, amendsRequestId, suggestion (SCRUM-40).

**DR5 Slot holding and overlap.** A request holds its venue and period if and only if its status is PENDING or APPROVED. Two periods overlap when they are for the same venue and date and `a.start < b.end` and `b.start < a.end` (half-open, so back-to-back is allowed). Setup and turnaround time, operating hours and blocked periods are not considered in this release (customer, Weeks 2 and 4).

**DR6 One active request per event.** [DECIDED] An event may have at most one request in PENDING or APPROVED at a time.

**DR7 Repeat guard.** [PROPOSED] A new or amended request for an event must differ in venue, date, start or end from every REJECTED request previously made for that event.

**DR8 Snapshot.** [DECIDED] At submission the request copies the event's name, expected attendance, venue requirements and accessibility needs. Later edits to the event do not change an existing request. No stale marker in this release.

**DR9 Event eligibility.** [PROPOSED] A venue request may be raised only when the event status is Approved or Planning, and only by the event's current assigned Coordinator. Every other status (Draft, Submitted, Under Review, Rejected, Confirmed, Completed, Cancelled) is ineligible. Status names are provisional until the event status list is fixed (SCRUM-8).

**DR10 Effect of approval.** [DECIDED] The event's venue booking is its APPROVED request, if any. Approval changes no field on the event and does not change event status. Confirmation stays a manual Coordinator action.

**DR11 Atomicity.** The overlap check and the insert are one atomic operation. Two simultaneous overlapping submissions result in exactly one PENDING request. Two simultaneous decisions on one request result in exactly one success and one 409 `NOT_PENDING`.

**DR12 Error contract.** [PROPOSED] Validation failure: 422 with per-field errors. Business-rule refusal: 409 with one code from `SLOT_CONFLICT`, `NOT_PENDING`, `NOT_REJECTED`, `REPEAT_OF_REJECTED`, `ACTIVE_REQUEST_EXISTS`, `EVENT_NOT_ELIGIBLE`, `SUGGESTION_ALREADY_USED`, `NO_SUGGESTION`, `SLOT_IN_PAST`, `DUPLICATE_VENUE`, `VERSION_CONFLICT`. Unknown venue or request id: 404. Refusals never reveal another event's name or Coordinator.

**DR13 Audit.** Every request records who acted and when: submitted, decided, withdrawn. Venue edits record who and when, with old and new values (SCRUM-58).

**DR14 Venue Staff scope.** [PROPOSED] Every Venue Staff user sees and decides requests for all venues. There is no venue-to-staff ownership.

**DR15 No notifications.** Notifications (SCRUM-46 and 47) are Backlog. Outcomes reach the Coordinator only through the "my bookings" list (SCRUM-33).

**DR16 Interfaces assumed.** [PROPOSED] Booking logic reads event data through one `EventReader` interface returning: id, name, status, assignedCoordinatorId, expectedAttendance, venueRequirements, accessibilityNeeds, proposedDate, proposedStart, proposedEnd. Tests use a fake. This lets these stories be built before SCRUM-24 and SCRUM-42 are finished and fits the microservices stack (SCRUM-63).

### Proposed new stories (not in the export)

- **N1 Release booking when an event is cancelled, rejected or withdrawn.** [CUSTOMER] The customer named "cancelled events keep occupying venues" as a pain point, and nothing here releases a PENDING or APPROVED request when its event ends. Blocked on event cancellation and change requests (core feature #19). Suggested rule to confirm: cancelling the event withdraws a PENDING request and releases an APPROVED booking.
- **N2 Approved booking affected by a later change.** Reschedules or attendance changes after approval (core feature #19) need a rule for the booking. The customer's Week 4 answer says the Coordinator handles it manually.

## Open items

**For you (each has a default in the file):**
1. Coordinators may not see the Venue Staff queue (SCRUM-37, Scenario 7).
2. UI confirmation before approve and reject (SCRUM-38, SCRUM-39).
3. One role per account (DR1).
4. Error and status codes in DR12.
5. Confirm SCRUM-40 moves into Sprint 2 (Medium) in Jira.

**For the customer (interim rules given):**
1. What happens to an approved booking when the event is cancelled or rescheduled, or the venue becomes unavailable (N1, N2)?