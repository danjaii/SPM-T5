# Venue Booking Approval: Final User Stories

Final user stories for the **Venue Booking Approval** core feature (ConnectSphere, IS212), compiled 2026-09-29.
Companion to [venue-booking-request.md](venue-booking-request.md), which holds SCRUM-32/33/35/36/59/60 and the shared rules
(`DRn`) cited below (appendix of that file).

- Scenario numbers are the test IDs: `37-S3` means SCRUM-37, Scenario 3.
- Markers: **[DECIDED]** the team chose it. **[PROPOSED]** a default, confirm or change.
- **SCRUM-40 (Suggest Alternative Arrangement) is not in the current sprint.** It is only a seam here: the reject
  body must accept an optional `suggestion` later without a breaking change.

| Order | Key | Title | Depends on |
| --- | --- | --- | --- |
| 1 | SCRUM-37 | Review Pending Request Queue | SCRUM-15, SCRUM-32 |
| 2 | SCRUM-38 | Approve Booking Request | SCRUM-36, SCRUM-37 |
| 3 | SCRUM-39 | Reject Booking Request With Reason | SCRUM-36, SCRUM-37 |

## Implementation decisions (2026-09-30)

These override the text below where they conflict.

- **Endpoints** (all need a session, 401 otherwise; wrong role 403):

  | Story | Method + path | Who | Response |
  | --- | --- | --- | --- |
  | 37 | `GET /booking-queue` | venue_staff | 200 `QueueItem[]`, `[]` when none |
  | 37 | `GET /booking-queue/:id` | venue_staff | 200 `QueueDetail`, 404 if unknown |
  | 38 | `POST /venue-bookings/:id/approve` | venue_staff | 200 `DecisionDto` |
  | 39 | `POST /venue-bookings/:id/reject` body `{ reason }` | venue_staff | 200 `DecisionDto`, 422 `fieldErrors.reason` |
  | 38 | `GET /events/:eventId/venue-booking` | the event's assigned Coordinator | 200 `{ venueName, date, startTime, endTime } \| null` |

- **Queue order.** `created_at` ascending, then `id` ascending as the tie-break (37-S2).
- **Order of checks (both decisions).** Wrong role: 403. Unknown id: 404. Not PENDING: 409 `NOT_PENDING`.
  Approve only: start already passed (compared with the injected clock): 409 `SLOT_IN_PAST`.
  Reject only: reason not 1 to 500 characters after trimming: 422 with `fieldErrors.reason`.
  Then `decide()`. If `decide()` returns nothing, another decision won the race: 409 `NOT_PENDING`.
- **Reject body.** A zod object `{ reason }`. Unknown keys are stripped, so SCRUM-40 can add an optional `suggestion`.
  The reason is stored trimmed.
- **Event booking.** The event's venue booking is its APPROVED request (DR10). No event field or status changes.
- **Organiser visibility (39-S7).** Migration 08 removes the organiser clause from the `venue_bookings` SELECT policy,
  so the reason cannot be read from the database directly. Nothing reads bookings as an organiser today.
- **Field mapping.** decidedBy / decidedAt / rejectionReason = `reviewed_by` / `reviewed_at` / `review_notes`.
  PENDING = `requested`. Times are shown as Singapore date and `HH:MM` (DR3).
- **Coordinators do not see the queue** (37-S7). They use SCRUM-33. [PROPOSED]
- **Confirm step.** The UI asks Venue Staff to confirm before approving or rejecting. [PROPOSED]

---

## SCRUM-37 Review Pending Request Queue

**User story.** As Venue Staff, I want to see all pending venue booking requests with the event details attached, so that
I can assess each request without contacting the Coordinator for information.

### Acceptance criteria

*Scenario 1: Queue contents.* Given three booking requests have status "Pending", when I open the pending requests queue,
then all three are listed, and each shows the venue, requested date and time, event name, expected attendance, venue
requirements, accessibility needs, requesting Coordinator and submission time.

*Scenario 2: Ordered first-come, first-served.* Given pending requests were submitted at 09:00, 10:00 and 11:00, when I
open the queue, then they are listed with the earliest submission first, and requests with the same submission time are
listed in the order they were created.

*Scenario 3: Decided and withdrawn requests leave the queue.* Given a request has been approved, rejected or withdrawn,
when I open the queue, then that request is not listed.

*Scenario 4: Amended requests.* Given a Coordinator amended a rejected request and the new request is "Pending", when I
open the queue, then the new request is listed at its own submission time and shows that it amends an earlier request.

*Scenario 5: Empty queue.* Given no requests have status "Pending", when I open the queue, then the message
"No pending booking requests." is shown rather than an error.

*Scenario 6: Request detail.* Given a request exists, when I open it from the queue or by its address, then I see
everything shown in the queue plus its status. For a decided request I also see who decided, when, and the rejection
reason if there is one. If it amends an earlier request I see the link to that request.

*Scenario 7: Access is restricted to Venue Staff.* Given I am logged in as an Event Organiser, Event Coordinator,
Technical Support Staff member or Attendee, when I attempt to open the queue, then I am denied access.

### Notes

Venue Staff retain approval authority. In Sprint 1 the system presents the information; it does not compute a suitability
verdict (that arrives with core feature #11). The event details shown are the values copied onto the request at
submission (DR8), so Venue Staff assess what was actually requested. All Venue Staff see all pending requests for all
venues (DR14). No paging or filtering in this release.

### Tests (rules: DR2, DR4, DR8, DR12, DR14)

| Scenario | Test |
| --- | --- |
| 37-S1 | 3 PENDING requests across two venues: 200, all three returned with all fields; values equal the snapshot even after the event is edited. |
| 37-S2 | Order `submittedAt` ascending; two rows with equal `submittedAt` ordered by id ascending. |
| 37-S3 | APPROVED, REJECTED and WITHDRAWN rows are excluded from the queue. |
| 37-S4 | An amendment R2 appears with its own `submittedAt` and an "amends R1" indicator (`amendsRequestId`). |
| 37-S5 | Empty queue returns 200 with `[]`; the UI shows "No pending booking requests." |
| 37-S6 | Detail returns the fields above for PENDING and decided requests; unknown id returns 404. |
| 37-S7 | ORGANISER, COORDINATOR, TECHNICAL_SUPPORT, ATTENDEE get 403 on queue and detail; no session 401. |

**Out of scope.** Pagination, filtering, suitability verdicts.

---

## SCRUM-38 Approve Booking Request

**User story.** As Venue Staff, I want to approve a venue booking request, so that the venue is committed to that event
and the Coordinator can continue planning.

### Acceptance criteria

*Scenario 1: Approving a pending request.* Given request R for "Orchid Hall" on 2026-11-14, 09:00-17:00 has status
"Pending", when I approve R and confirm, then its status becomes "Approved", the decision time and my identity are
recorded, and it no longer appears in the pending queue.

*Scenario 2: A decided request cannot be approved again.* Given R has status "Approved", "Rejected" or "Withdrawn", when I
open R, then the approve action is unavailable, and an approval attempted anyway is refused.

*Scenario 3: Two decisions at the same moment.* Given two Venue Staff members decide R at the same moment, when both are
processed, then only one succeeds and the other is told the request is no longer pending.

*Scenario 4: The event shows its approved venue.* Given R is approved for event "TechConf 2026", when a Coordinator views
the event's venue booking, then it shows "Orchid Hall" on 2026-11-14, 09:00-17:00, and the event's status and other
details are unchanged.

*Scenario 5: The venue becomes committed.* Given R has been approved, when another Coordinator submits an overlapping
request for "Orchid Hall", then that request is refused.

*Scenario 6: The outcome reaches the Coordinator.* Given R has been approved, when the requesting Coordinator opens their
venue bookings list, then R is shown with status "Approved" and its decision date.

*Scenario 7: No automatic suitability check.* Given the event's expected attendance is higher than the venue's capacity,
when I approve the request, then the approval succeeds, as Venue Staff make the final decision.

*Scenario 8: The requested time has already passed.* Given the request's start time has already passed, when I attempt to
approve it, then the approval is refused and I am told the requested time is in the past.

*Scenario 9: Only Venue Staff may approve.* Given I am not Venue Staff, including the Coordinator who raised the request,
when I attempt to approve a request, then I am denied access.

### Notes

Approval commits the venue for the requested period; with SCRUM-36, an approved booking blocks any overlapping request.
**[DECIDED]** approving records the venue against the event but does not change the event's status (DR10); the
Coordinator confirms the event manually.

### Tests (rules: DR2, DR3, DR4, DR5, DR10, DR11, DR12, DR13)

| Scenario | Test |
| --- | --- |
| 38-S1 | 200; status APPROVED; decidedBy and decidedAt set; absent from the queue. |
| 38-S2 | For APPROVED, REJECTED, WITHDRAWN: the UI action is hidden, the API returns 409 `NOT_PENDING`. |
| 38-S3 | Two parallel decisions (approve+approve, approve+reject): exactly one succeeds, the other 409 `NOT_PENDING`. |
| 38-S4 | The event's booking query returns Orchid Hall, 2026-11-14, 09:00-17:00; event status and every other event field unchanged. |
| 38-S5 | Integration: an overlapping request from another event returns 409 `SLOT_CONFLICT`. |
| 38-S6 | Integration: the SCRUM-33 list shows APPROVED and decidedAt. |
| 38-S7 | Attendance above capacity: 200, APPROVED. |
| 38-S8 | Request start in the past: 409 `SLOT_IN_PAST`. [PROPOSED] |
| 38-S9 | COORDINATOR (including the requester), ORGANISER, TECHNICAL_SUPPORT, ATTENDEE get 403; no session 401. |

---

## SCRUM-39 Reject Booking Request With Reason

**User story.** As Venue Staff, I want to reject a booking request and record why, so that the Coordinator understands
the decision and can plan an alternative.

### Acceptance criteria

*Scenario 1: Rejecting with a reason.* Given R has status "Pending", when I reject R with the reason "Room under
renovation until 2026-12-01" and confirm, then its status becomes "Rejected", the reason, decision time and my identity are
recorded, the reason is visible to the requesting Coordinator, and it no longer appears in the pending queue.

*Scenario 2: A reason is required.* Given R is "Pending", when I attempt to reject it with an empty reason, a reason of
only spaces, or a reason longer than 500 characters, then a validation message is shown and R remains "Pending".

*Scenario 3: Rejections are final.* Given R has status "Rejected", when I open R, then no action is available to approve,
edit or reopen it, and an attempt anyway is refused. If the Coordinator amends it (SCRUM-60), a new request is created and
R itself is not changed.

*Scenario 4: The slot is released on rejection.* Given R held "Orchid Hall" on 2026-11-14, 09:00-17:00, when I reject R,
then another Coordinator can successfully request "Orchid Hall" for that period.

*Scenario 5: Only pending requests can be rejected.* Given R has status "Approved" or "Withdrawn", or another Venue Staff
member decided it a moment ago, when I attempt to reject R, then the rejection is refused because the request is no longer
pending, and R keeps its current status.

*Scenario 6: The event is not changed.* Given R is rejected, when a Coordinator views the event, then the event's status
and details are unchanged.

*Scenario 7: Only Venue Staff may reject, and who sees the reason.* Given I am not Venue Staff, when I attempt to reject a
request, then I am denied access. The reason is visible only to Venue Staff and the event's assigned Coordinator, not to
the Event Organiser.

### Notes

The customer confirmed rejections are final (no override or appeal). The reason is mandatory, 1 to 500 characters after
trimming. This story ships without the optional suggested alternative; SCRUM-40 adds it to the same reject action later.

### Tests (rules: DR2, DR4, DR5, DR11, DR12, DR13)

| Scenario | Test |
| --- | --- |
| 39-S1 | 200; status REJECTED; reason, decidedBy, decidedAt stored; SCRUM-33 detail returns the reason; absent from the queue. |
| 39-S2 | Reasons `""`, `"   "` and a 501-character string return 422; request stays PENDING. 1-character and 500-character reasons succeed. |
| 39-S3 | On a REJECTED request, approve or reject returns 409 `NOT_PENDING`; a SCRUM-60 amend leaves the original row unchanged. |
| 39-S4 | Integration with SCRUM-36: another event can request the same slot (201). |
| 39-S5 | APPROVED and WITHDRAWN requests return 409 `NOT_PENDING`; two parallel decisions give one success and one 409. |
| 39-S6 | Event status and event fields unchanged after rejection. |
| 39-S7 | Non-VENUE_STAFF get 403; no session 401; the ORGANISER gets 403 on the request detail and cannot read the row from the database (migration 08). |

---

## SCRUM-40 Suggest Alternative Arrangement (not this sprint)

Adds an optional `suggestion` (venue, date, start, end) to the SCRUM-39 reject action. The repository's `Decision`
type and the `suggested_*` columns already exist as the seam. Specified in full in the source stories; to be built later.
