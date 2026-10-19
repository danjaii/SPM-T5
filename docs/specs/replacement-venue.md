# Replacement Venue: Final User Story

User story for **Request a Replacement Venue for an Affected Booking** (ConnectSphere, IS212), compiled 2026-10-15.

- Scenario numbers are the test IDs: `107-S3` means SCRUM-107, Scenario 3. Jira does not number the ACs, so
  **Scenario n is AC n** in test names and commit titles **[PROPOSED]** (confirm with the PO).
- Markers: **[DECIDED]** the team chose it (the Wave 2 plan of 2026-10-15). **[PROPOSED]** a default, confirm or change.
- **Built (2026-10-17).** The spec was written before the code; the decisions below match what shipped, with the migration numbers 47 and 48 (40 and 41 were taken while it waited, then 43 and 44, then 45 and 46). It stacks on SCRUM-106 (`docs/specs/venue-unavailability-flags.md`) and needs
  SCRUM-110 merged, because a replacement request goes through `submit()`, which runs the suitability check
  (`docs/specs/venue-request-suitability.md`). Facts about Wave 1 are read from its branches.

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-107 | [Venue Unavailability] Request a Replacement Venue for an Affected Booking | SCRUM-32 (submit a request, `docs/specs/venue-booking-request.md`), SCRUM-38 (approve, `docs/specs/venue-booking-approval.md`), SCRUM-105 (blocks), SCRUM-106 (the flag it starts from); built on SCRUM-103 (padding), SCRUM-104 (flags), SCRUM-110 (suitability); interacts with SCRUM-98 and SCRUM-102 |

## Implementation decisions (2026-10-15)

These override the text below where they conflict.

- **A new linked request, not an edit.** Approved bookings still cannot be amended (SCRUM-59/60 Scenario 3), and the original
  decision stays on record (Customer Briefing 8f). A replacement is a new PENDING venue booking whose `amends_booking_id` is
  the original, the same link SCRUM-60 uses for a rejected request. The original is not written until the replacement is
  approved. **[DECIDED]**
- **User decision 3 (15/10): allowed on a Confirmed event.** A replacement may be requested whenever the original booking
  carries an open `venue_unavailable` flag, **even if the event is Confirmed**. This is a documented exception to
  `assertMayRequestFor`, which only lets an event in `approved`, `planning` or `awaiting_arrangements` raise a venue request
  (`canRequestVenue`). `submit()` gets an option `replacesBookingId`; with it, the event-status rule becomes "the event is not
  finished" (`completed`, `cancelled` and `rejected` still answer `EVENT_NOT_ELIGIBLE`, the same set as
  `equipment_request_event_open` in migration 25) **[PROPOSED]** for the exact set. The assigned-coordinator rule is kept. The
  database does not check event status on insert (the policy in migration 07 checks the coordinator only), so no migration is
  needed for the exception. **[DECIDED]**
- **User decision 4 (15/10): equipment follows.** When a replacement is approved, the original booking's equipment requests
  (`equipment_reservations.venue_booking_id`, migration 25) move to the replacement and are reset to `requested`
  ("Submitted") with no quantity reserved and no reviewer, exactly as `change_venue_booking()` does for a new period
  (SCRUM-102/AC8). Cancelled rows stay where they are. The statuses it names are only `requested` and `cancelled`, so it is
  unaffected by PR #75's `under_review`. **[DECIDED]**
- **Migrations 47 and 48.** `47_venue_booking_replaced_status.sql`: `alter type venue_booking_status add value 'replaced'`
  (alone in its file; a new enum value cannot be used in the transaction that adds it). `48_venue_booking_replacement.sql`:
  - `replaced_by_booking_id uuid references venue_bookings(id)` and `replaced_at timestamptz`, with a unique index on
    `replaced_by_booking_id` and a check that a `replaced` booking has both. They are not in the UPDATE grant of migration 07,
    so only the trigger below writes them.
  - a `security definer` trigger **`venue_booking_take_over`**, `AFTER UPDATE OF status ON venue_bookings` when a row goes
    `requested` to `approved` and has `amends_booking_id`. It locks the original `FOR UPDATE` and acts **only if the original is
    holding and has an open `venue_unavailable` flag**, so an ordinary amendment (the original is rejected, 60-S1) is untouched.
    Then, in one transaction with the approval: the original becomes `replaced` with `replaced_by_booking_id` and `replaced_at`;
    its open flags are resolved with reason `replaced` (SCRUM-104's resolving trigger maps the new status to that reason); its
    equipment moves as above. A `replaced` booking is not holding, so it stops occupying its venue at once (107-S3) and the
    padded overlap trigger and `available_venues` need no change. **[DECIDED]**
  - It names no enum value other than `requested`, `approved`, `replaced` and the equipment statuses above, so it does not
    conflict with other open migrations. **[DECIDED]**
- **Rejecting a replacement leaves the original flagged (107-S4).** The decide path writes only the replacement (`rejected`);
  the trigger does nothing. The original stays `approved` (or `requested`) with its flag, and "Find replacement" is available
  again. A rejected replacement is **not** amended (SCRUM-60) or re-accepted (SCRUM-59), since a new request linked to the
  rejected replacement would not be linked to the original and so would not take over: `amend` and `accept-suggestion` refuse
  it with `409 REPLACEMENT_REJECTED` "A rejected replacement cannot be amended. Choose Find replacement on the original
  booking." **[PROPOSED]**
- **One pending replacement at a time (107-S5).** The service checks first (`409 REPLACEMENT_PENDING` "This booking already
  has a replacement request waiting for a decision."). The unique index `venue_bookings_one_active_replacement` (migration 28) on
  `amends_booking_id` for holding statuses settles two requests at the same instant; its violation is `ACTIVE_REQUEST_EXISTS`
  today with the text for a rejected request, so the replacement path maps it to `REPLACEMENT_PENDING`. After the replacement
  is approved the original is `replaced` and has no open flag, so "Find replacement" is gone. **[DECIDED]**
- **Only flagged bookings, only the assigned Coordinator (107-S6).** Checks in order: not a coordinator `403`; unknown
  booking `404`; not the event's assigned coordinator `403` (a Lead's reassignment moves the right with the event, as in
  SCRUM-102); no open `venue_unavailable` flag, or the booking is not holding `409 NOT_FLAGGED` "Only a booking flagged as
  unavailable can be replaced."; a replacement already pending `409 REPLACEMENT_PENDING`. A booking flagged only as "Buffer
  conflict" is `NOT_FLAGGED` **[PROPOSED]** (open question). **[DECIDED]**
- **Finding replacements (107-S1).** `GET /venue-bookings/:id/replacement-candidates` (same checks as above) returns the
  active venues that are free for the original's period **including setup and turnaround and including unavailability blocks**
  (`available_venues`, redefined for padding in SCRUM-103 and blocks in SCRUM-105), whose maximum capacity is at least the
  booking's own expected attendance (Jira: 120). It leaves out the original's venue, any venue where the event already holds a
  booking that overlaps (it would be `DUPLICATE_VENUE`), and any venue where the event has a **rejected** request for the same
  period (it would be `REPEAT_OF_REJECTED`, which includes an earlier rejected replacement). Each item: `venueId`, `name`,
  `address`, `maxCapacity`. Sorted by name. Empty is `200 []`. **[DECIDED]**
- **Submitting (107-S2).** `POST /venue-bookings/:id/replacement` body `{ venueId, overrideReason? }` answers `201` with the
  new booking (the usual `SubmittedBookingDto`) plus `replaces` (the original's id). Every field except the venue is the
  original's: date, start, end, expected attendance and venue requirements, so nothing is re-entered. It calls `submit()`
  with `replacesBookingId`, so every normal rule applies: slot conflict (`SLOT_CONFLICT`), blocks (`VENUE_UNAVAILABLE`),
  unknown or retired venue `404`, and the suitability check of SCRUM-110. A replacement does **not** inherit the original's
  suitability result or override reason: an unsuitable venue needs its own `overrideReason` (`409 UNSUITABLE_VENUE` without
  one; the web shows the same confirm step). `venueId` missing is `422`. **[DECIDED]**
- **Changing or cancelling an original while its replacement is pending.** Proposed: `change()` and `cancel()` (SCRUM-102) of a
  booking with a pending replacement answer `409 REPLACEMENT_PENDING`; the coordinator withdraws the replacement first (SCRUM-35,
  which already works on any PENDING request). Without this, cancelling the original first would make the later approval an
  ordinary one and leave the event holding two venues. **[PROPOSED]**
- **API and shared code.**
  - `REPLACED` is added to `VENUE_BOOKING_STATUSES` and `replaced` to the DB-to-API map; `NOT_FLAGGED`, `REPLACEMENT_PENDING` and
    `REPLACEMENT_REJECTED` join `VENUE_BOOKING_ERROR_CODES`. `HOLDING_DB_STATUSES` does not change.
  - The booking detail DTO gains `replacedBy` (the replacement: id, venue name, date, times, status) when the booking was
    replaced or has a pending replacement, `replaces` (the original) on a replacement, and `flagHistory` (every flag with
    `resolvedAt` and `resolvedReason`, open or resolved), so the original and its flag reason stay visible after the
    take-over (107-S3). The queue DTO and `decided` handling in `queueDto.ts` treat `REPLACED` as a finished status.
  - `amendmentChain` needs **no change**: it already follows `amends_booking_id` links from any root, whatever the root's
    status (the plan expected a change; it is only the web `bookingActions` that needs one).
- **Built as.** `ReplacementService` (`services/replacementService.ts`) owns both endpoints and calls `submit()` with
  `replacesBookingId`; `assertMayReplaceFor` is the Confirmed-event exception (`canRequestReplacement` in `packages/shared`). The
  rejected-replacement rule treats a rejected booking whose parent is not itself rejected as a replacement
  (`REPLACEMENT_REJECTED`). Changing or cancelling the original while a replacement waits is `REPLACEMENT_PENDING` [PROPOSED, built].
  The venue-search reader is built lazily, only when a replacement is asked for. **[DECIDED]**
- **Where the event shows the new venue (107-S3).** `GET /events/:eventId/venue-bookings`, `GET /events/:eventId/venue-booking`
  (first approved booking) and `list_public_events()` (statuses `approved`, `confirmed`) all key off the booking status, so once the
  original is `replaced` they show the replacement with no code change. For a multi-venue event (SCRUM-98) only the replaced
  arrangement changes. **[DECIDED]**
- **Web.** A page `app/venue-bookings/[id]/replacement/page.tsx` lists the candidates with "Request this venue"; the
  `UnsuitableConfirm` step of SCRUM-110 handles `UNSUITABLE_VENUE`. `VenueBookingActions` shows "Find replacement" when
  `bookingActions` says so (flagged `venue_unavailable`, holding, no pending replacement, caller is the coordinator); it is
  hidden for everyone else. `EventVenueBookings` shows REPLACED with a "Replaced by Lotus Room" link, and the replacement with
  "Replaces Orchid Hall". The detail page keeps the original's banner and flag history. Text labels, not colour alone. **[DECIDED]**
- **Seeded data cannot show this on its own.** The only seeded flagged-able booking with a large event is the Pacific Rim Gala
  (380 attendees) at Riverside Grand Ballroom (500), and the next largest seeded venue is Marina Bayview Hall A (300), so a
  replacement search for the Gala is empty. The E2E therefore creates a throwaway venue (service role, as the SCRUM-101 E2E
  does) and a smaller flagged booking. **[DECIDED]**

---

## SCRUM-107 Request a Replacement Venue for an Affected Booking

**User story.** As an Event Coordinator, I want to request a replacement venue for a booking affected by venue unavailability,
so that the event can still go ahead without me re-entering its details.

### Acceptance criteria

*AC1 (Scenario 1, finding replacement options).* Given the "TechConf 2026" booking for "Orchid Hall" on 2026-11-14, 09:00-17:00
for 120 attendees is flagged "Venue unavailable – alternative needed", when I choose "Find replacement", then I see only venues
that are free for that period, including setup and turnaround, and have capacity of at least 120, and "Orchid Hall" is not listed.

*AC2 (Scenario 2, submitting a replacement request).* Given I am viewing the replacement options, when I select "Lotus Room" and
submit, then a request is created with status "Pending", pre-filled with the original booking's date, time, expected attendance
and requirements, the request references the original booking, and the original booking remains flagged and unchanged.

*AC3 (Scenario 3, an approved replacement takes over).* Given my replacement request for "Lotus Room" is Pending, when Venue
Staff approve it, then the original "Orchid Hall" booking's status becomes "Replaced", its flag is cleared, and it no longer
occupies "Orchid Hall"; the event shows "Lotus Room" as the venue for that arrangement; and the original booking and its flag
reason remain visible in the booking history.

*AC4 (Scenario 4, a rejected replacement leaves the original flagged).* Given my replacement request is rejected, when I open the
original booking, then it is still flagged and I can choose "Find replacement" again.

*AC5 (Scenario 5, only one replacement request at a time).* Given a replacement request for the flagged booking is Pending, when I
open the flagged booking, then "Find replacement" is unavailable.

*AC6 (Scenario 6, only flagged bookings, and only by the assigned Coordinator).* Given an Approved booking that is not flagged,
when I open it, then "Find replacement" is unavailable; and given I am not the event's assigned Coordinator, when I attempt to
request a replacement, then I am denied access.

### Notes from Jira

Week 7 Change 2. Approved bookings still cannot be amended (SCRUM-59/60, Scenario 3). A new linked request keeps the original
decision on record (Customer Briefing 8f). For a multi-venue event (SCRUM-98), only the replaced arrangement changes.

### Interaction with other stories

- **SCRUM-60 / 59.** Reuse the `amends_booking_id` link and `submit()`. An ordinary amend of a rejected request is unchanged,
  because the take-over trigger acts only when the original is holding and flagged.
- **SCRUM-98.** `DUPLICATE_VENUE` and per-booking attendance apply; the replacement carries the original booking's own numbers.
- **SCRUM-102.** `change_venue_booking()` and `cancel_venue_booking()` are untouched in SQL; the service refuses them while a
  replacement is pending (proposed above). A replaced booking is not changeable (`NOT_ACTIVE`).
- **SCRUM-103 / 105.** Candidates and the replacement's own checks use padded periods and blocks.
- **SCRUM-104 / 106.** The flag, the approve guard (a flagged replacement itself cannot be approved) and the resolving trigger.
- **SCRUM-110.** The replacement is suitability-checked fresh; the confirm step reuses `UnsuitableConfirm`.
- **Equipment.** Moves with the take-over (decision 4). Equipment staff see the request again as Submitted.

### Tests

| ID | Scenario |
| --- | --- |
| 107-S1 | `replacement-candidates` for the flagged 14 Nov 09:00 to 17:00 booking of 120 returns only active venues free for that period including the venues' setup and turnaround and unavailability blocks, with capacity of at least 120, never "Orchid Hall", never a venue the event already holds, never one with a rejected request of the same period; a too-small venue and one whose padding touches the period are absent (AC1). |
| 107-S2 | Choosing Lotus Room creates a PENDING booking with the original's date, times, attendance and requirements, `amends_booking_id` = the original, `201`; the original is still `approved` and still flagged, byte-identical; it works on a **Confirmed** event (decision 3), and `EVENT_NOT_ELIGIBLE` still answers for a completed or cancelled event; an unsuitable venue needs its own `overrideReason`; `SLOT_CONFLICT` and `VENUE_UNAVAILABLE` apply (AC2). |
| 107-S3 | Venue staff approve the replacement: the original is `replaced` with `replaced_by_booking_id` and `replaced_at`; its flag is resolved with reason `replaced` and still readable in `flagHistory`; Orchid Hall is free for the period again (a new request is accepted); the event's venue list shows Lotus Room and the original as "Replaced by Lotus Room"; its equipment moved to the replacement and is `requested` with no quantity; other bookings of a multi-venue event are untouched (AC3). |
| 107-S4 | Venue staff reject the replacement: the original is unchanged and still flagged; "Find replacement" works again and a second candidate list is returned; amending the rejected replacement is `REPLACEMENT_REJECTED`; the same venue and period is no longer a candidate (AC4). |
| 107-S5 | With a replacement PENDING, `replacement-candidates` and `POST replacement` are `409 REPLACEMENT_PENDING` and the page shows no button; 20 simultaneous `POST`s create exactly one booking and the rest are `REPLACEMENT_PENDING`; changing or cancelling the original is `REPLACEMENT_PENDING` [PROPOSED]; withdrawing the replacement frees the button (AC5). |
| 107-S6 | An Approved booking with no flag, or with only a buffer-conflict flag, is `409 NOT_FLAGGED` (and `Find replacement` is absent); another coordinator, a lead, an organiser and venue staff are `403`; an unknown booking is `404`; 401 without a session (AC6). |
| 107-S7 | An ordinary amendment (a rejected original, SCRUM-60) approved later does **not** change anything on the old booking; approving a replacement whose original's flag was resolved meanwhile is an ordinary approval. |
| DB | The take-over trigger: replaces only a holding original with an open unavailable flag; sets `replaced_*`, resolves flags (`replaced`), moves non-cancelled equipment and resets it; is atomic with the approval (a failure rolls the approval back); a signed-in user cannot write `replaced_*`; the unique index allows one replacement per original; migration 47 is a file of its own. |
| UI | "Find replacement" shows for the assigned coordinator on a flagged holding booking only; the candidates page lists the venues and the confirm step handles an unsuitable one; `EventVenueBookings` shows REPLACED with the link; `bookingActions` unit tests. |
| E2E | On a Confirmed event, Rachel finds a replacement for a flagged booking (fixture venue large enough), a second attempt is refused, Kenneth rejects, she requests again, he approves; the original shows REPLACED with its flag reason, the event shows the new venue, and the equipment is Submitted on the new booking (AC1 to AC5). |

### Out of scope

- Suggesting the replacement automatically, or ranking candidates; showing each candidate's suitability before the request.
- Moving a booking to a venue in the same request (use SCRUM-102 for a time change).
- Replacing a booking flagged only as "Buffer conflict" (see questions).
- Notifications about the replacement's decision (SCRUM-47's triggers stay unassigned).
- Cancelling the event, or changing its status. Flags and replacements never touch the event.

### Open questions for the product owner

1. **May a booking flagged "Buffer conflict" also be replaced?** Proposed: no; fix it with SCRUM-102 (change or cancel one
   booking). Jira SCRUM-107 says "affected by venue unavailability" only.
2. **A flagged Pending request:** may it have a replacement, or must the coordinator withdraw and request again? Proposed: allowed
   (it is flagged and holding), but a Pending original is the rarer case.
3. **Changing or cancelling the original while a replacement is Pending** is refused until the replacement is withdrawn. Proposed.
4. **After a rejected replacement,** may the coordinator ask for the same venue and period again? Proposed: no (the repeat-of-rejected
   rule, DR7), and the venue is left out of the candidates.
5. **Which event statuses may use the Confirmed exception?** Proposed: any event that is not completed, cancelled or rejected.
6. **Equipment reset.** Approved or reserved equipment returns to Submitted on the replacement (decision 4). Is technical support
   to be told? Proposed: not in this story.
