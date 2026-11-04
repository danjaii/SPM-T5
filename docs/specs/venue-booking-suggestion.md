# Suggest Alternative Arrangement: Final User Story

User story for **[Venue Booking Approval] Suggest Alternative Arrangement** (ConnectSphere, IS212), compiled 2026-11-02.

- Scenario numbers are the test IDs: `40-S3` means SCRUM-40, Scenario 3. The three acceptance criteria are numbered 1 to 3 as in the Jira story, and **Scenario n is AC n**.
- Markers: **[DECIDED]** settled by an earlier spec, the schema or the code as it is. **[PROPOSED]** a default, confirm or change.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-40 | [Venue Booking Approval] Suggest Alternative Arrangement | SCRUM-39 (reject with a reason, `venue-booking-approval.md`), SCRUM-59 and SCRUM-60 (the coordinator accepts or amends, `venue-booking-request.md`) |

Why: when Venue Staff reject a request they usually know a venue or time that would work. Without a way to say so, the coordinator
has to start the venue search again. The database (`suggested_venue_id`, `suggested_start_datetime`, `suggested_end_datetime`),
the repository's `Decision` type, the coordinator's view of a suggestion and the one-click "Accept suggested alternative"
(SCRUM-59) all exist already. What is missing is the reject action that lets Venue Staff attach one. It was kept apart from
SCRUM-39 on purpose, so rejection could ship if this was descoped.

## Implementation decisions (2026-11-02)

- **The suggestion is optional and rides on the reject action [DECIDED].** `POST /venue-bookings/:id/reject` takes
  `{ reason, suggestion? }`, where `suggestion` is `{ venueId, date, startTime, endTime }` (date `YYYY-MM-DD`, times `HH:MM`,
  Singapore time, as every other venue form). With no `suggestion` the rejection works exactly as before (40-S2). Nothing else
  changes in the reject path: the order of checks (role, existence, status, then the body) and the final, slot-releasing rejection
  are SCRUM-39's. The suggestion is stored with the rejection in the same conditional update, so a lost race (`NOT_PENDING`)
  stores none.
- **All four fields or none [PROPOSED].** A suggestion with a venue but no time, or a time but no venue, is a 422 that names the
  missing field, under `suggestion.<field>`. A blank `suggestion` object (every field empty) is read as no suggestion, so the form can
  send what it has.
- **What makes a suggestion valid [PROPOSED].**
  - The venue exists and is active (the `venues` row, `is_active`). An unknown or inactive venue is a 422 on `suggestion.venueId`.
  - The date is a real date, and the period starts in the future (the injected clock, as approve's `SLOT_IN_PAST`), and the end is after the
    start. These are the same rules the coordinator's own request obeys, from the shared `venueBooking` helpers.
  - The suggestion may be the same venue as the rejected request (a different time), or another venue (the same or a different
    time). A suggestion identical to the rejected request is allowed and not special-cased; it is pointless, not harmful.
  - Venue Staff are not stopped from suggesting a venue that is booked, closed or too small: **a suggestion is advice, not a
    hold (40-S3)**. The coordinator's accept action runs the real checks (conflict, suitability, opening hours) when they take it
    (SCRUM-59, SCRUM-110).
- **A suggestion does not hold the slot [DECIDED].** The overlap rule (`venue_bookings_padded_overlap`, migration 27) counts only
  holding statuses, and a rejected request is not one, so a stored suggestion changes nothing for anybody else. Another
  coordinator's request for the suggested venue and period is created Pending (40-S3). No code is needed for this; the test proves it.
- **What the coordinator sees [DECIDED, built].** `GET /venue-bookings/:id` already returns the suggested venue's name, date
  and times and the page already shows it with **Accept suggested alternative** (SCRUM-33, SCRUM-59). A rejection with a suggestion
  also keeps the reason, as before.
- **Web.** The Reject dialog (SCRUM-134) gets an optional **Suggest an alternative** part: a venue choice, a date, a start and an end.
  It is closed by default; the reason stays required and the button keeps its meaning. The same shared parser as the service checks the
  fields, so a problem is named on its field before anything is sent. The venue choices come from the venue catalogue (every active
  venue). **[PROPOSED]**
- **No migration [DECIDED].** The columns exist (migration 06) and the repository already writes them. If the integration test finds the
  column grant of migration 07 refuses Venue Staff writing them, a migration will be added; the test decides, not this document.

---

## SCRUM-40 Suggest Alternative Arrangement

**User story.** As Venue Staff, I want to suggest an alternative venue or time when rejecting a request, so that the Coordinator can
adjust rather than restart the venue identification process.

### Acceptance criteria

*AC1.* Given I am rejecting request R for "Orchid Hall" on 2026-11-14, when I select "Lotus Room" on 2026-11-15, 09:00 to 17:00 as a
suggested alternative, then the suggestion is stored with the rejection, and the requesting Coordinator can see the suggested venue,
date and time.

*AC2.* Given I am rejecting request R, when I submit the rejection with a reason but no suggested alternative, then the request is
rejected successfully.

*AC3.* Given I rejected request R suggesting "Lotus Room" on 2026-11-15, 09:00 to 17:00, when a different Coordinator requests "Lotus
Room" for that period, then their request is created with status "Pending".

### Tests

| ID | Scenario |
| --- | --- |
| 40-S1 | Venue Staff reject with a reason and a suggestion: 200, the request is Rejected with its reason, and the suggestion is stored (venue, start and end in UTC from the Singapore date and times); the requesting coordinator's detail shows the suggested venue's name, date and times and offers Accept; the Reject dialog sends the suggestion it was given (AC1). |
| 40-S2 | Venue Staff reject with a reason and no suggestion (and with a blank one): 200, Rejected, nothing stored as a suggestion, exactly as SCRUM-39 (AC2). |
| 40-S3 | After a rejection that suggests the Lotus Room on a day, a different coordinator's request for that venue and period is created Pending, and the suggestion is still stored; the database accepts it, since a rejected request holds no slot (AC3). |
| 40-S4 | An invalid suggestion is a 422 on its field and nothing is rejected: a missing or unknown or inactive venue, a date that is not a real date or is in the past, an end that is not after the start, a venue with no times or times with no venue; the reason is still checked as before (AC1). |
| 40-S5 | Only Venue Staff can reject with a suggestion (everyone else is 403 first, even with an invalid body); a decided request cannot be rejected again (`NOT_PENDING`) and stores no suggestion (AC1, AC2). |
| E2E | Venue Staff open a pending request, reject it with a reason and a suggestion, and see it Rejected; the coordinator opens the request and sees the suggestion with Accept (AC1, AC3 by the unit and database tests). |

### Out of scope

- Checking that the suggested venue is free, open, or big enough when it is suggested (the coordinator's accept action does).
- Suggesting more than one alternative, or suggesting on an approval.
- A notification to the coordinator beyond the rejection one that already exists (migration 65); it links to the request, where
  the suggestion is.
- Suggesting a change to the equipment or the attendance.

### Open questions (each has a proposed default, shown in the decisions above)

1. **All four fields or none.** Default: yes. Whether Venue Staff may suggest only a new venue with the original time, or only a new
   time at the same venue, is a small relaxation if the team wants it; the form would pre-fill the original values to make this easy.
2. **Inactive venues.** Default: refused. An inactive venue cannot be requested anyway.
3. **A suggestion in the past.** Default: refused, like approve. A suggestion that was future when written and is past when the
   coordinator reads it is handled by the accept action's own check.
