# Venue Booking Request: Final User Stories

Final user stories for the **Venue Booking Request** core feature (ConnectSphere, IS212). Compiled 2026-09-29 from the revised cards.

## How to use this file

- Each story has two parts. **Part A** is a code block in Jira wiki markup (`h2.`, `*bold*`, `* bullets`). Copy everything inside the block and paste it over the story's Description body in Jira. **Part B** is the implementation spec for Claude Code and is not for Jira.
- Scenario numbers in Part A are the test IDs. `32-S3` means SCRUM-32, Scenario 3. Part B refers to scenarios by these numbers. **Tests must name the scenario ID they cover.**
- Part B cites shared rules as `DRn` (for example `DR2`). Those rules are in the appendix of this file.
- Markers: **[DECIDED]** you chose it on 2026-09-29. **[PROPOSED]** a default, confirm or change. **[CUSTOMER]** needs a customer answer; an interim rule is given.
- Amended stories: all 6 stories in this feature were rewritten. There are no unamended stories in this feature.
- Other files: SCRUM-37, 38, 39 and 40 (queue, approve, reject, suggest) are in `venue-booking-approval-final.md`. SCRUM-29 (catalogue) is in `venue-catalogue-final.md`. Several tests here are integration tests with those stories.
- Global build order across all three files: SCRUM-29, 36, 32, 37, 38 and 39, 40, 33 and 35, 60, 59. SCRUM-57 and 58 are not in this sprint.

## Implementation decisions (2026-09-29)

Where this spec meets the existing schema (`supabase/migrations/01_schema.sql`) and code, these decisions apply. They override the spec text below where they conflict.

- **Data model.** Extend the existing `venue_bookings` table (new migrations); do not add a new table.
- **Status mapping.** API status to DB `venue_booking_status`: `PENDING` = `requested`; `APPROVED` = `approved` (legacy `tentative` and `confirmed` rows also read as APPROVED and also hold the slot); `REJECTED` = `rejected`; `WITHDRAWN` = `withdrawn` (new enum value). Legacy `cancelled` is not part of this feature.
- **Field mapping.** submittedBy / submittedAt = `requested_by` / `created_at`. decidedBy / decidedAt = `reviewed_by` / `reviewed_at`. rejectionReason = `review_notes`.
- **Time.** Stored as timestamptz (`event_start_datetime`, `event_end_datetime`). The API takes an Asia/Singapore `date` plus `HH:MM` start and end. Setup and teardown columns are ignored in this release.
- **DR9 eligibility.** Eligible event statuses are `approved`, `planning` and `awaiting_arrangements`. All others, including `returned`, are ineligible. (The real `event_status` enum differs from the provisional names in the stories.)
- **Snapshot "venue requirements".** `events` has no venue-requirements column, so the snapshot stores the preferred room layout name. *To confirm with the team.*
- **Start in the past.** Returns 422 with a field error (32-S5). The `SLOT_IN_PAST` code from DR12 is not used on submit.
- **Suggestion `usedAt`.** Derived from the accepting request (`from_suggestion = true`, `amends_booking_id` = the rejected request); a unique index makes a second accept fail atomically.
- **Scope.** Only the minimum seams for SCRUM-29 and SCRUM-37 to 40 are built here: a venue list for the form picker, a pending-queue query and a decide operation at repository level.
- **Not visible means not found.** With per-role RLS (migration 07) a coordinator cannot read another coordinator's request, so for them it looks the same as an unknown id and the API answers 404 rather than 403. Either way access is denied and nothing about the request is revealed. Where a row is visible but the caller is not the assigned Coordinator, the answer is 403. The slot pre-check uses the `venue_slot_is_held` database function so RLS cannot hide a holder from it.
- **Integration tests.** DB-backed tests (36-S4, 35-S5 and others) run against local Supabase and in a dedicated CI job.

## Story index

| Order | Key | Title | Jira priority / sprint today | Depends on | Jira field change |
| --- | --- | --- | --- | --- | --- |
| 1 | SCRUM-36 | Prevent Double-Held Venue Slot | Medium, Sprint 1, Sprint 2 | SCRUM-29 | no change |
| 2 | SCRUM-32 | Submit Venue Booking Request | Medium, Sprint 1, Sprint 2 | SCRUM-15, SCRUM-24, SCRUM-29, SCRUM-36, SCRUM-42 | no change |
| 3 | SCRUM-33 | Track Venue Booking Requests | Medium, Sprint 1, Sprint 2 | SCRUM-32 | no change |
| 4 | SCRUM-35 | Withdraw Pending Request | Medium, Sprint 1, Sprint 2 | SCRUM-32 | no change |
| 5 | SCRUM-60 | Amend Rejected Request to a Different Venue | Medium, Sprint 1, Sprint 2 | SCRUM-32, SCRUM-36, SCRUM-39 | optional: rename Summary to "Amend Rejected Request" (it now allows a different venue, date or time) |
| 6 | SCRUM-59 | Accept Suggested Alternative | Medium, Sprint 1, Sprint 2 | SCRUM-36, SCRUM-40, SCRUM-60 | no change |

---

## SCRUM-36 Prevent Double-Held Venue Slot

### Part A: Jira description

```text
h2. User Story

As an Event Coordinator, I want the system to stop me requesting a venue slot another event already holds, so that two events are never promised the same venue.

h2. Acceptance Criteria

*Scenario 1: Overlapping requests are refused*

* Given event "Summit A" holds "Orchid Hall" on 2026-11-14, 09:00-17:00 with a Pending or an Approved request
* When I submit a request for a different event, "Summit B", for "Orchid Hall" on 2026-11-14 for any of these periods:

||Period requested||Why it overlaps||
|13:00-18:00|Partly overlaps|
|09:00-17:00|Identical|
|10:00-12:00|Falls inside|
|08:00-18:00|Contains the held period|
|16:59-18:00|Overlaps by one minute|

* Then the request is refused
* And I see a message that the venue is already held for part of that period

*Scenario 2: Non-overlapping requests are permitted*

* Given event "Summit A" holds "Orchid Hall" on 2026-11-14, 09:00-17:00 with a Pending or an Approved request
* When I submit a request for "Summit B" in any of these cases:

||Request||Why it is allowed||
|"Orchid Hall" 2026-11-14, 17:00-18:00|Starts exactly when the held period ends|
|"Orchid Hall" 2026-11-14, 07:00-09:00|Ends exactly when the held period starts|
|"Orchid Hall" 2026-11-15, 09:00-17:00|Different date|
|"Lotus Room" 2026-11-14, 09:00-17:00|Different venue|

* Then the request is created with status "Pending"

*Scenario 3: Released slots become requestable*

* Given the only request for "Orchid Hall" on 2026-11-14, 09:00-17:00 has status "Rejected" or "Withdrawn"
* When a different event's Coordinator submits a request for "Orchid Hall" for that same period
* Then the request is created with status "Pending"

*Scenario 4: Simultaneous requests*

* Given two Coordinators, for different events, submit overlapping requests for "Orchid Hall" at the same moment
* When both are processed
* Then exactly one request is created with status "Pending"
* And the other is refused as already held

*Scenario 5: The refusal does not expose other events*

* Given a request is refused because the venue is held
* When I read the refusal
* Then it does not show the holding event's name, its Coordinator or its request

h2. Notes

Traceable to two customer answers. Week 4 (Bryan, G1): tentative holding is in scope for Release 1, limited to one active tentative hold or confirmed booking per venue and time slot; auto-expiry rules and simultaneous multi-venue holds are not required. Week 2 (Megan and Charles, G2): venue allocation is strictly first-come, first-served, with no manual override.

Assumption: a Pending request is the tentative hold and an Approved request is the confirmed booking. Both hold the slot. Rejected and Withdrawn requests do not. There is no expiry, so a Pending request holds the slot until it is decided or withdrawn.

Assumption: setup and turnaround time are excluded for this release (Bryan G1, Haziq G2), so overlap uses the published start and end times only. Two periods overlap when each starts before the other ends, so back-to-back periods (Scenario 2, first row) do not overlap. Revisit if turnaround time is added. Venue operating hours and venue blocks are also not considered in this release.

This story is the shared rule used by SCRUM-32, 38, 39, 40, 59 and 60. The rule that one event may not re-request the same slot it was rejected for is in SCRUM-32.

h2. Depends On

* SCRUM-29 Browse and View Venues
```

### Part B: Agent implementation spec

Build this first. It is the shared slot rule (DR5, DR11), built as a domain service plus a data-layer guard and tested directly with request fixtures created through the repository. Other stories add one integration test each.

**Proposed interface.** [PROPOSED] `SlotConflictRule.check(venueId, date, start, end)` returns free or `SLOT_CONFLICT`; the insert path uses the same rule atomically.

**Tests.**
- `36-S1`: for each of the five periods, run with the holder in PENDING and again in APPROVED. Result is 409 `SLOT_CONFLICT`, nothing created. Message: "This venue is already held for part of that period."
- `36-S2`: each of the four cases creates a PENDING request (201).
- `36-S3`: holder REJECTED, then holder WITHDRAWN: a different event's request is created PENDING.
- `36-S4`: two concurrent submissions (parallel calls) for overlapping periods produce exactly one PENDING row and one 409 `SLOT_CONFLICT`. Run it repeatedly.
- `36-S5`: the 409 body contains only the code and message, with no event name, coordinator or request id.

**Implementation note.** Enforce at the data layer too. One option under Supabase/PostgreSQL is an exclusion constraint on venue and a half-open time range restricted to PENDING and APPROVED rows. The team decides.

**Out of scope.** Same-event rules (DR6, DR7 in SCRUM-32), auto-expiry of holds, turnaround time, operating hours, venue blocks.

---

## SCRUM-32 Submit Venue Booking Request

### Part A: Jira description

```text
h2. User Story

As an Event Coordinator, I want to submit a venue booking request for an event I am coordinating, so that Venue Staff have the event timing and requirements they need to assess the booking.

h2. Acceptance Criteria

*Scenario 1: Successful submission*

* Given I am logged in as the Event Coordinator assigned to event "TechConf 2026"
* And "TechConf 2026" has status "Approved" and has no Pending or Approved venue booking request
* And venue "Orchid Hall" exists in the venue catalogue
* When I submit a venue booking request for "Orchid Hall" on 2026-11-14 from 09:00 to 17:00
* Then the request is created with status "Pending"
* And the request displays the event name, requested date and time, expected attendance, venue requirements and accessibility needs
* And who submitted it and when are recorded
* And the request appears in the Venue Staff pending queue

*Scenario 2: Event details are carried onto the request*

* Given event "TechConf 2026" has a proposed date of 2026-11-14, time 09:00-17:00 and expected attendance of 120
* When I open the venue booking request form for that event
* Then the date, time and expected attendance are pre-filled from the event
* And I can adjust the requested date and time before submitting
* And I cannot change the expected attendance, venue requirements or accessibility needs on this form
* And the event's own proposed date and time are not changed by my submission

*Scenario 3: Only some event statuses allow a venue request*

* Given an event has one of these statuses:

||Event status||Can I raise a venue booking request?||
|Approved|Yes|
|Planning|Yes|
|Draft, Submitted, Under Review, Rejected, Confirmed, Completed, Cancelled|No|

* When I open the event
* Then the option to raise a venue booking request is available only where the table says Yes
* And where it says No, I see the message "The event must be approved before a venue can be requested."

*Scenario 4: Only the assigned Coordinator may raise the request*

* Given I am an Event Coordinator who is not assigned to event "TechConf 2026", or I am any other role
* When I attempt to raise a venue booking request for "TechConf 2026"
* Then I am denied access
* And no request is created

*Scenario 5: Invalid requested times or venue*

* Given I am raising a venue booking request
* When I submit with an end time that is not after the start time (for example start 17:00 and end 09:00, or start 09:00 and end 09:00), or a start in the past, or no venue chosen
* Then the request is rejected with a validation message
* And no request is created

*Scenario 6: One active request per event*

* Given "TechConf 2026" already has a Pending or Approved venue booking request
* When I submit another request for it
* Then the request is refused and I am told the event already has an active request
* And once its earlier request is Rejected or Withdrawn, I can submit a new one

*Scenario 7: A rejected slot cannot simply be requested again*

* Given "TechConf 2026" has a Rejected request for "Orchid Hall" on 2026-11-14 from 09:00 to 17:00
* When I submit a request for the same venue, date, start and end
* Then the request is refused and I am told to choose a different venue, date or time
* And a request that differs in any one of venue, date, start or end is accepted for checking

*Scenario 8: The slot is already held*

* Given another event holds "Orchid Hall" for an overlapping period (SCRUM-36)
* When I submit my request
* Then the request is refused as already held
* And no request is created

*Scenario 9: Attendance above venue capacity is not blocked*

* Given "TechConf 2026" has expected attendance 200 and "Orchid Hall" has capacity 150
* When I submit a request for "Orchid Hall"
* Then the request is created with status "Pending"

*Scenario 10: Event details on the request do not change afterwards*

* Given my request was created when expected attendance was 120
* When the event's expected attendance is later changed to 150
* Then the request still shows 120

h2. Notes

The Organiser supplies preferred dates and venue requirements; the Coordinator is the one who selects the venue and raises the request (Micah, G1). The request must carry enough event context that Venue Staff never have to contact the Coordinator for basic details.

Decision (team, 2026-09-29): an event may have only one Pending or Approved request at a time. The customer left holding several options for one event to the team's design.

Decision (team, 2026-09-29): the request keeps a copy of the event's name, attendance, venue requirements and accessibility needs as at submission (Scenario 10).

Assumption: Scenario 7 protects the customer's ruling that Venue Staff rejections are not overridden (Charles, G2), by requiring a changed venue, date or time after a rejection. It applies to every earlier rejected request for the event.

Assumption (to confirm): only events with status Approved or Planning can request a venue. Status names are provisional until the event status list is fixed (SCRUM-8).

Assumption: no capacity check is made at submission (Scenario 9). Suitability checking is core feature #11 (Sprint 3), and Venue Staff make the final decision (Charles, G2). Requested times and dates use Singapore time. A booking is within one calendar day.

h2. Depends On

* SCRUM-29 Browse and View Venues
* SCRUM-36 Prevent Double-Held Venue Slot
* SCRUM-24 Approve or Reject Submitted Event Request (sets the "Approved" status)
* SCRUM-42 Assign Event to Coordinator
* SCRUM-15 Role-Based Access Control
```

### Part B: Agent implementation spec

Rules used: DR2, DR3, DR4, DR6, DR7, DR8, DR9, DR11, DR12, DR13, DR16. Event data comes through the `EventReader` fake (DR16), so this story can be built before SCRUM-24 and SCRUM-42 are done.

**Stored on the request.** venueId, eventId, requestedDate, startTime, endTime, status PENDING, snapshot (eventName, expectedAttendance, venueRequirements, accessibilityNeeds), submittedBy, submittedAt (server time).

**Tests.**
- `32-S1`: 201; row is PENDING with snapshot, submittedBy, submittedAt; the SCRUM-37 queue query returns it (integration).
- `32-S2`: form defaults equal the event's date, times, attendance; date and time editable; other fields read-only; event's proposed date and times unchanged after submit.
- `32-S3`: run for each status. Approved and Planning return 201. The other seven return 409 `EVENT_NOT_ELIGIBLE` with "The event must be approved before a venue can be requested."; the UI control is hidden.
- `32-S4`: another Coordinator, ORGANISER, VENUE_STAFF, TECHNICAL_SUPPORT, ATTENDEE all get 403; no session gets 401; no row created.
- `32-S5`: 422 with field errors for end before start, end equal to start, start in the past, missing venue. Unknown venue id returns 404. No row created.
- `32-S6`: with a PENDING request, then again with an APPROVED request, a second submit returns 409 `ACTIVE_REQUEST_EXISTS`. With the earlier one REJECTED, then WITHDRAWN, submit returns 201.
- `32-S7`: identical venue, date, start, end as a REJECTED request returns 409 `REPEAT_OF_REJECTED`. Changing any one field is not refused by this rule. Also true against any earlier rejected request for the event, not only the latest.
- `32-S8`: integration with SCRUM-36: 409 `SLOT_CONFLICT`, no row.
- `32-S9`: attendance 200, capacity 150: 201 PENDING.
- `32-S10`: change the event's attendance after submission; the request's stored snapshot is unchanged.

**Out of scope.** Venue search and availability views, several active requests per event, notifications.

---

## SCRUM-33 Track Venue Booking Requests

### Part A: Jira description

```text
h2. User Story

As an Event Coordinator, I want to see every venue booking request for the events I coordinate and its current outcome, so that I know which events still need a venue without chasing Venue Staff.

h2. Acceptance Criteria

*Scenario 1: Requests are listed with their outcomes*

* Given I coordinate events with venue booking requests that are "Pending", "Approved", "Rejected" and "Withdrawn"
* When I open my venue bookings list
* Then each request shows the venue, event name, requested date and time, and status
* And Approved and Rejected requests additionally show the decision date
* And the most recently submitted request is shown first

*Scenario 2: A rejection reason and suggestion are visible*

* Given my request for "Orchid Hall" was rejected with the reason "Room under renovation", and Venue Staff suggested "Lotus Room" on 2026-11-15 from 09:00 to 17:00
* When I open that request
* Then the rejection reason is displayed
* And the suggested venue, date and time are displayed

*Scenario 3: Scoped to my own events*

* Given booking requests exist for events assigned to other Coordinators
* When I open my venue bookings list
* Then only requests for events assigned to me are shown

*Scenario 4: No requests yet*

* Given none of my events has a venue booking request
* When I open my venue bookings list
* Then the message "You have no venue booking requests." is shown rather than an error

*Scenario 5: Request detail and amendment history*

* Given request R2 was created by amending rejected request R1 (SCRUM-60 or SCRUM-59)
* When I open R2 or R1
* Then I see the chain of requests in order
* And R1 still shows its rejection, its reason and its decision date

*Scenario 6: The latest status is shown*

* Given Venue Staff have just approved one of my requests
* When I open or reload my venue bookings list
* Then that request shows "Approved" and its decision date

*Scenario 7: Other roles cannot use this list*

* Given I am Venue Staff, an Event Organiser, Technical Support Staff member or Attendee
* When I attempt to open a Coordinator's venue bookings list
* Then I am denied access

h2. Notes

This is how decisions reach the Coordinator in Sprint 1. The Notification System (core feature #20, SCRUM-46 and 47) is in the Backlog, not scheduled, so this list is the only channel for now. Event Coordinators are permitted to view venue availability and booking data (Ewen, G1).

Assumption (to confirm): "my requests" means requests for events where I am the current assigned Coordinator, including requests a previous Coordinator raised. After reassignment the previous Coordinator no longer sees them in this list.

Venue Staff see requests through the pending queue (SCRUM-37), not this list.

h2. Depends On

* SCRUM-32 Submit Venue Booking Request
```

### Part B: Agent implementation spec

Rules used: DR2, DR4, DR12, DR15.

**Ownership.** Filter by `event.assignedCoordinatorId = currentUser` through `EventReader`, not by `submittedBy`. [PROPOSED]

**List row fields.** venue name, event name, requestedDate, start-end, status, decidedAt (only APPROVED and REJECTED), submittedAt. Order by `submittedAt` descending. No pagination or filters. [PROPOSED]

**Detail view (also the source for 59 and 60).** All list fields, snapshot fields, rejectionReason, suggestion (venue name, date, start, end), and the amendment chain via `amendsRequestId`.

**Tests.**
- `33-S1`: seed four requests (one per status) for one Coordinator; 200, four rows in `submittedAt` descending order, decision date only on APPROVED and REJECTED.
- `33-S2`: detail returns rejectionReason and suggestion.
- `33-S3`: requests for another Coordinator's events are absent.
- `33-S4`: empty list returns 200 with an empty array; UI shows the empty-state text.
- `33-S5`: R1 REJECTED, R2 amends R1. Detail of either returns `[R1, R2]` in order; R1 still REJECTED with reason and decidedAt.
- `33-S6`: approve a request through the SCRUM-38 path; the next list call shows APPROVED and decidedAt (no cache).
- `33-S7`: VENUE_STAFF, ORGANISER, TECHNICAL_SUPPORT, ATTENDEE get 403; no session 401.

---

## SCRUM-35 Withdraw Pending Request

### Part A: Jira description

```text
h2. User Story

As an Event Coordinator, I want to withdraw a venue booking request that is no longer needed, so that Venue Staff do not assess a dead request and the venue slot is not held unnecessarily.

h2. Acceptance Criteria

*Scenario 1: Withdrawing a pending request*

* Given my request for "Orchid Hall" has status "Pending"
* When I withdraw the request and confirm
* Then the request status becomes "Withdrawn"
* And who withdrew it and when are recorded
* And the request no longer appears in the Venue Staff pending queue

*Scenario 2: Only pending requests can be withdrawn*

* Given my request has status "Approved", "Rejected" or "Withdrawn"
* When I open the request
* Then the withdraw action is unavailable
* And a withdrawal attempted anyway is refused

*Scenario 3: Only the assigned Coordinator may withdraw*

* Given I am not the Event Coordinator assigned to the request's event, or I am any other role
* When I attempt to withdraw the request
* Then I am denied access
* And the request stays "Pending"

*Scenario 4: The slot is released*

* Given my pending request held "Orchid Hall" on 2026-11-14 from 09:00 to 17:00
* When I withdraw the request
* Then another Coordinator can successfully request "Orchid Hall" for that period
* And I can submit a new venue booking request for my event

*Scenario 5: Withdrawal and a decision at the same moment*

* Given Venue Staff approve or reject the request at the same moment I withdraw it
* When both are processed
* Then only one succeeds
* And the other is refused because the request is no longer Pending

h2. Notes

Releasing an already-approved booking is cancellation behaviour and is out of scope for this story. Nothing yet releases a booking when its event is cancelled, rejected or withdrawn; raise this with the customer (see the customer pain point that cancelled events keep occupying venues).

Assumption (to confirm): the screen asks the Coordinator to confirm before withdrawing.

h2. Depends On

* SCRUM-32 Submit Venue Booking Request
```

### Part B: Agent implementation spec

Rules used: DR2, DR4, DR5, DR6, DR11, DR12, DR13.

**Transition.** PENDING to WITHDRAWN only. Store `withdrawnBy`, `withdrawnAt`.

**Tests.**
- `35-S1`: 200; status WITHDRAWN; audit fields set; absent from the SCRUM-37 queue.
- `35-S2`: for APPROVED, REJECTED and WITHDRAWN, UI action hidden and API returns 409 `NOT_PENDING`.
- `35-S3`: a Coordinator not assigned to the event, ORGANISER, VENUE_STAFF, TECHNICAL_SUPPORT, ATTENDEE get 403; no session 401; status stays PENDING.
- `35-S4`: integration with SCRUM-36 and SCRUM-32: another event can request the same venue and period (201), and the same event can submit a new request (201).
- `35-S5`: withdraw and approve (also withdraw and reject) in parallel: exactly one succeeds; the other returns 409 `NOT_PENDING`.

**Out of scope.** Cancelling APPROVED bookings, releasing bookings when the event ends (see "Proposed new stories" in the appendix).

---

## SCRUM-60 Amend Rejected Request to a Different Venue

### Part A: Jira description

```text
h2. User Story

As an Event Coordinator, I want to amend a rejected booking request by choosing a different venue, date or time, so that I can continue planning even when I don't want to use Venue Staff's suggested alternative.

h2. Acceptance Criteria

*Scenario 1: Amending a rejected request*

* Given my event has a Rejected request R1 for "Orchid Hall" on 2026-11-14 from 09:00 to 17:00, and no Pending or Approved request
* When I amend it to "Lotus Room" on 2026-11-14 from 09:00 to 17:00 and submit
* Then a new request is created with status "Pending"
* And the new request refers to R1 as the request it amends
* And R1 remains "Rejected" with its reason and decision date unchanged

*Scenario 2: The amendment must differ from earlier rejections*

* Given my event has Rejected requests
* When I amend with the same venue, date, start and end as any of them
* Then the amendment is refused and I am told to choose a different venue, date or time
* And an amendment that differs in any one of venue, date, start or end is accepted for checking

*Scenario 3: The same checks as a new request apply*

* Given I am amending a rejected request
* When the event is not in a status that allows a venue request, or the times are invalid, or the slot is held by another event
* Then the amendment is refused in the same way as for a new venue booking request (SCRUM-32 and SCRUM-36)

*Scenario 4: Only rejected requests can be amended*

* Given my request has status "Pending", "Approved" or "Withdrawn"
* When I open the request
* Then the amend action is unavailable
* And an amendment attempted anyway is refused

*Scenario 5: One active request at a time*

* Given I already amended R1 and the new request is "Pending" or "Approved"
* When I amend R1 again
* Then the amendment is refused because the event already has an active request

*Scenario 6: Amending an amendment*

* Given the new request R2 was also rejected
* When I amend R2
* Then a new request R3 is created that refers to R2
* And the request history shows R1, R2 and R3 in order

*Scenario 7: Only the assigned Coordinator may amend*

* Given I am not the Event Coordinator assigned to the event, or I am any other role
* When I attempt to amend the request
* Then I am denied access

h2. Notes

Reuses the venue selection and checks of SCRUM-32, so it inherits SCRUM-36's double-hold prevention for the newly chosen slot.

Assumption: amending never changes the rejected request. It creates a new Pending request that refers to the original, so the original decision stays on record for auditability, and the customer's ruling that rejections are not overridden (Charles, G2) holds.

Amending works whether or not Venue Staff suggested an alternative (Rey, G2: the Coordinator adjusts the request without restarting the planning process). The event's own proposed date and time are not changed by amending.

h2. Depends On

* SCRUM-32 Submit Venue Booking Request
* SCRUM-36 Prevent Double-Held Venue Slot
* SCRUM-39 Reject Booking Request With Reason
```

### Part B: Agent implementation spec

Rules used: DR2, DR4, DR6, DR7, DR8, DR9, DR11, DR12. Implement as one amend path shared with SCRUM-59.

**Behavior.** Create a new PENDING request with `amendsRequestId` set to the rejected request; take a fresh snapshot from `EventReader`; set a new `submittedAt`. Never write to the original.

**Tests.**
- `60-S1`: 201; new row PENDING with `amendsRequestId = R1`; R1 row is byte-for-byte unchanged (status, reason, decidedAt).
- `60-S2`: identical venue, date, start, end to R1, or to an earlier rejected request R0 of the same event: 409 `REPEAT_OF_REJECTED`. Change each of the four fields one at a time: not refused by this rule.
- `60-S3`: ineligible event status returns 409 `EVENT_NOT_ELIGIBLE`; invalid times return 422; overlapping held slot returns 409 `SLOT_CONFLICT`.
- `60-S4`: R1 in PENDING, APPROVED, WITHDRAWN: 409 `NOT_REJECTED`; UI action hidden. R1 REJECTED with and without a suggestion: allowed.
- `60-S5`: amend R1 to R2 (PENDING), then amend R1 again: 409 `ACTIVE_REQUEST_EXISTS`. Repeat with R2 APPROVED.
- `60-S6`: reject R2, amend R2 to R3; history of any of the three returns `[R1, R2, R3]`. No chain-length limit.
- `60-S7`: other Coordinator and other roles 403; no session 401.

---

## SCRUM-59 Accept Suggested Alternative

### Part A: Jira description

```text
h2. User Story

As an Event Coordinator, I want to accept the alternative venue Venue Staff suggested when rejecting my booking request with one action, so that I can continue planning without re-entering the venue details.

h2. Acceptance Criteria

*Scenario 1: Accepting a suggested alternative*

* Given my event has a Rejected request R1 for "Orchid Hall" on 2026-11-14, and no Pending or Approved request
* And Venue Staff suggested "Lotus Room" on 2026-11-15 from 09:00 to 17:00
* When I accept the suggested alternative
* Then a new request is created with status "Pending" for "Lotus Room" on 2026-11-15 from 09:00 to 17:00
* And the new request refers to R1 as the request it amends
* And R1 remains "Rejected" with its reason and decision date unchanged

*Scenario 2: The suggested slot has been taken since*

* Given another event now holds "Lotus Room" for an overlapping period on 2026-11-15
* When I accept the suggested alternative
* Then the request is refused as already held
* And the suggestion is still shown so I can amend the request instead (SCRUM-60)

*Scenario 3: A suggestion can be accepted once*

* Given I already accepted the suggestion on R1
* When I try to accept it again
* Then I am refused and told the suggestion has already been used

*Scenario 4: There must be a suggestion on a rejected request*

* Given request R1 has no suggested alternative, or R1 is "Pending", "Approved" or "Withdrawn"
* When I open the request
* Then the accept action is unavailable
* And an acceptance attempted anyway is refused

*Scenario 5: The event is not changed*

* Given the suggested date differs from the event's proposed date
* When I accept the suggestion
* Then the event's own proposed date and time are not changed

*Scenario 6: Only the assigned Coordinator may accept*

* Given I am not the Event Coordinator assigned to the event, or I am any other role
* When I attempt to accept the suggestion
* Then I am denied access

h2. Notes

Directly traceable to the customer answer (Rey, G2): Venue Staff can suggest an alternative arrangement and the Coordinator adjusts the request rather than restarting the full planning process. The original decision must survive the amendment for auditability.

Decision (team, 2026-09-29): keep this story separate from SCRUM-60. This story is a one-action accept of the exact suggested venue, date and time. Changing anything is SCRUM-60. Both use the same amend rules.

The same checks as a new venue booking request apply (event status, times, double-hold), as in SCRUM-60. A suggestion does not hold its slot (SCRUM-40), so it can be taken before it is accepted.

h2. Depends On

* SCRUM-40 Suggest Alternative Arrangement
* SCRUM-60 Amend Rejected Request to a Different Venue
* SCRUM-36 Prevent Double-Held Venue Slot
```

### Part B: Agent implementation spec

Rules used: DR2, DR4, DR6, DR7, DR8, DR9, DR11, DR12. Calls the SCRUM-60 amend path with the suggestion's venue, date, start and end. Do not duplicate validation.

**Suggestion state.** The suggestion on the rejection has `usedAt` (null until accepted).

**Tests.**
- `59-S1`: 201; new PENDING row for Lotus Room, 2026-11-15, 09:00-17:00 with `amendsRequestId = R1`, fresh snapshot, new `submittedAt`; R1 unchanged; suggestion `usedAt` set.
- `59-S2`: slot held by another event: 409 `SLOT_CONFLICT`, no row, `usedAt` still null, suggestion still returned by SCRUM-33 detail.
- `59-S3`: second accept: 409 `SUGGESTION_ALREADY_USED`, no second row.
- `59-S4`: rejected request with no suggestion: 409 `NO_SUGGESTION`. R1 PENDING, APPROVED, WITHDRAWN: 409 `NOT_REJECTED`. UI action hidden in each case.
- `59-S5`: event's proposed date and times unchanged after accept.
- `59-S6`: other Coordinator and other roles 403; no session 401.

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

**DR9 Event eligibility.** [PROPOSED] A venue request may be raised only when the event status is Approved or Planning, and only by the event's current assigned Coordinator. Every other status (Draft, Submitted, Under Review, Rejected, Confirmed, Completed, Cancelled) is ineligible. Status names are provisional until the event status list is fixed (SCRUM-8). *(See "Implementation decisions": `awaiting_arrangements` is also eligible.)*

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
1. "My bookings" follows the current assigned Coordinator after reassignment (SCRUM-33).
2. Only Approved and Planning events can request a venue (DR9), pending the final event status list.
3. UI confirmation before withdraw (SCRUM-35).
4. One role per account (DR1).
5. SCRUM-59 as one-click accept and SCRUM-60 as editable amend.
6. Error and status codes in DR12.

**For the customer (interim rules given):**
1. What happens to bookings when an event is cancelled or rescheduled (N1, N2)?
2. Can one event hold more than one venue (DR6 assumes one)?
