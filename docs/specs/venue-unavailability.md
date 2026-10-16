# Venue Unavailability: Final User Story

User story for **Mark a Venue Temporarily Unavailable** (ConnectSphere, IS212), compiled 2026-10-15.

- Scenario numbers are the test IDs: `105-S4` means SCRUM-105, Scenario 4. Jira does not number the ACs, so
  **Scenario n is AC n** in test names and commit titles **[PROPOSED]** (confirm with the PO).
- Markers: **[DECIDED]** the team chose it (the Wave 2 plan of 2026-10-15). **[PROPOSED]** a default, confirm or change.
- **Built on main after Wave 1.** Wave 1 (SCRUM-101, 103, 109, 110: migrations 26, 27 and 33) is merged; this spec was
  re-read against that code on 2026-10-16. Migrations 37 and 38 are the next free pair (31, 32 are PR #75's, 35 is SCRUM-46's,
  36 is SCRUM-104's).

| Key | Title | Depends on |
| --- | --- | --- |
| SCRUM-105 | [Venue Unavailability] Mark a Venue Temporarily Unavailable | SCRUM-29 (venue catalogue, `venue_unavailability` table), SCRUM-102 (change or cancel one booking); built on SCRUM-103 (padded occupancy, `docs/specs/venue-padded-occupancy.md`); SCRUM-106 (`docs/specs/venue-unavailability-flags.md`) handles the bookings that are already there |

Existing bookings that fall inside a new block are **not** handled here (Jira: "handled in C2-2"); that is SCRUM-106. This
story records the block, shows it, and refuses new requests that overlap it.

## Implementation decisions (2026-10-15)

These override the text below where they conflict.

- **The table already exists.** `venue_unavailability` (migration 01) has `venue_id`, `start_datetime`, `end_datetime`
  (`end > start`), `reason` (enum), `notes`, `created_by`, `created_at`, and four seeded blocks (maintenance, renovation, safety
  and one `internal_activity`). Nothing writes to it today except the seed, and its only row policy is the blanket
  `venue_unavailability_authenticated_all` (02). **[DECIDED]**
- **Reasons.** The enum has `maintenance`, `renovation`, `safety`, `internal_activity`, `other`; the Jira reason "Equipment
  failure" is missing. Migration `37_venue_unavailability_reason_equipment_failure.sql` adds `equipment_failure`
  (`alter type ... add value`, in a file of its own, because a new enum value cannot be used in the transaction that adds it).
  Selectable: Maintenance, Equipment failure, Renovation, Safety concern (the enum value `safety`), Other. `internal_activity`
  stays in the enum and in the seed, and is shown, but cannot be chosen for a new block. **[DECIDED]**
- **Only a function may write.** Migration `38_venue_unavailability_marking.sql` replaces the blanket policy: SELECT for
  `venue_staff` and `event_coordinator` (through `current_user_role()`, migration 07); INSERT, UPDATE and DELETE are revoked
  from `authenticated` and `anon`. The one writer is `mark_venue_unavailable(p_venue_id, p_start, p_end, p_reason, p_notes)`,
  `security definer`, which returns the new row's id and:
  - refuses anyone but venue staff with `42501` (105-S6);
  - refuses an end that is not after the start, an unknown or non-selectable reason (including `internal_activity`) and a
    blank reason with `22023` (105-S2, 105-S3), and an unknown venue with `P0002`;
  - locks the venue row `FOR NO KEY UPDATE`, the same lock SCRUM-103's overlap trigger takes, so a block and a request for the
    same venue are checked one after the other (no race);
  - inserts the row with `created_by = auth.uid()` and the time recorded (`created_at`), and writes an `activity_log` row
    (DR13). **[DECIDED]**
  The service validates first with the shared parser and answers 422; the database insists too. Coordinators, organisers,
  attendees and technical support cannot read the table. **[DECIDED]**
- **No setup or turnaround on a block.** A block is compared as it is: `[start, end)`. A **booking** is compared with its
  padded period (`venue_padded_period`, SCRUM-103), so both its setup and its turnaround count against the block. The
  boundary is half-open: with setup 30, 18:15 to 20:00 occupies from 17:45 and is refused by a block ending 18:00; 18:30 to
  20:00 occupies from 18:00, only touches the block and is accepted (105-S5). A booking ending at 08:00 with a 30 minute
  turnaround is refused by a block starting 08:00 for the same reason. **[DECIDED]**
- **Where the check lives.** Three places, all agreeing:
  1. `venue_bookings_check_padded_overlap()` (migration 27) is re-created in migration 38 with the full body copied and one more
     rule: a padded booking period that overlaps a block raises SQLSTATE **`CS105`**, after the booking overlap check. The
     trigger's skip rule is unchanged, so a request that keeps its venue and period (a decision, a withdrawal, new numbers)
     is not re-checked: **a Pending request that was already inside a block when the block was made can still be approved**
     until SCRUM-106 flags it and SCRUM-104's guard refuses it. Merge 106 straight after 105. **[DECIDED]**
  2. `venue_unavailability_conflicts(venue, start, end)` (new, `security definer`, venue staff and coordinators only, `42501`
     otherwise) returns the blocks that overlap the padded period of a would-be booking, with the venue name, for the
     friendly pre-check and for the message after a lost race. It returns period only: no reason, notes or `created_by`.
     **[DECIDED]**
  3. `available_venues(start, end)` (18, redefined in 27) is redefined again (v3): the venue's **padded** request period
     is compared with the unpadded block, so venue search (SCRUM-65) never offers a venue that a request would refuse.
     `venue_slot_is_held` keeps meaning "held by a booking" and is not changed. **[DECIDED]**
- **The refusal (105-S4).** `409 VENUE_UNAVAILABLE`, new in `VENUE_BOOKING_ERROR_CODES`, message
  "Orchid Hall is unavailable from 14 Nov 08:00 to 16 Nov 18:00", built by `unavailableMessage` in `packages/shared`
  from the block's own period in Singapore time. When several blocks overlap, the earliest is named. The message does **not**
  give the reason or the notes **[PROPOSED]** (open question). It names no booking, event or coordinator (36-S5). **[DECIDED]**
- **Order in `submit()` and `change()`.** After the existing checks and `slotRule.check` (a held slot is still `SLOT_CONFLICT`,
  so 103's behaviour and tests are unchanged), the pre-check asks `venue_unavailability_conflicts`. `submit()`, `change()`
  (SCRUM-102) and `persist()` (103-S7) all handle it, so a request that loses a race to the new trigger gets the same
  specific message. `translate()` maps `CS105` to a `VENUE_UNAVAILABLE` error and `persist()` looks the block up again.
  Amending (SCRUM-60) and accepting a suggestion (SCRUM-59) go through `submit()` and are covered with no more code. **[DECIDED]**
- **Suitability seam (SCRUM-109/110).** `availabilityLookup` (`services/availabilityLookup.ts`) returns the first of a held
  slot or a block, with a `kind` of `held` or `unavailable`, so the suitability report says "not available" for a block too.
  The `AvailabilityConflict` type in `packages/shared/src/venueSuitability.ts` gets that optional `kind`. **[DECIDED]**
- **Endpoints** (`venue-service`; need a session, 401 otherwise; `/venues` already answers 403 to every role but
  `event_coordinator` and `venue_staff`) **[DECIDED]**:

  | Method + path | Who | Response |
  | --- | --- | --- |
  | `POST /venues/:id/unavailability` body `{ startDate, startTime, endDate, endTime, reason, notes? }` (Singapore time) | venue_staff | 201 the new block (see below); 403 for a coordinator (checked before validation, even for an invalid body); 404 unknown venue; 422 `{ code: "VALIDATION_FAILED", error, fieldErrors }` |
  | `GET /venues/:id` | coordinator, venue_staff | adds `can_mark_unavailable` (true for venue staff only) and `unavailability`, the venue's blocks that have not ended, earliest first |
  | `GET /venues/:id/availability?date=` (SCRUM-103) | coordinator, venue_staff | adds `unavailable`, the blocks touching that Singapore day, so the page can draw them |

  A block as returned: `id`, `startDate`, `startTime`, `endDate`, `endTime` (Singapore), `reason`, `reasonLabel`, `notes`,
  `recordedBy` (the member of staff's name) and `recordedAt`. Coordinators see the same period and reason label but not
  `notes` or `recordedBy` (the service leaves them out) **[PROPOSED]**. Unknown ids and malformed dates answer as the rest of `/venues` does. **[DECIDED]**
- **Shared code.** `packages/shared/src/venueUnavailability.ts` holds the reasons and labels,
  `parseUnavailabilityInput` (zod; date and time fields in Singapore time, reason required, end after start, notes optional up
  to 500 characters), `formatShortSgt` ("14 Nov 08:00") and `unavailableMessage`. The parser reports every field at once.
  A period that starts in the past is allowed (a venue can break today) **[PROPOSED]**. Notes are required when the reason is
  Other **[PROPOSED]** (open question). **[DECIDED]** for the file itself, it needs only
  `sgtToUtc` and `utcToSgt`.
- **Web.** `VenueDetail` lists the upcoming blocks ("14 Nov 08:00 to 16 Nov 18:00, Maintenance"). Venue staff also see a
  `VenueUnavailabilityForm` (start and end date and time, a reason select, notes, "Mark unavailable"); coordinators see the
  list and no form (105-S6). `VenueAvailabilityDay` (SCRUM-103) draws an "Unavailable" segment next to Setup, Event and
  Turnaround, labelled in text as well as colour. The coordinator's request form shows the refusal message inline. **[DECIDED]**
- **Unreadable by organisers.** Event Organisers, Attendees and Technical Support have no `/venues` access and no SELECT on the table. **[DECIDED]**

## Corrections found against the merged code (2026-10-16)

- `availabilityLookup` on main is still the unpadded `hasHold` stub (it was not switched to `SlotConflictRule`), so this story
  extends it in place: a held slot is reported as before, and only when nothing holds the slot is the earliest block returned.
- `venue_bookings_check_padded_overlap`, `available_venues`, `venue_slot_conflicts` and `venue_occupied_periods` are still the
  migration 27 bodies (28, 30, 33 and 34 do not redefine them), so migration 38 copies 27's trigger and `available_venues`.
- The padding trigger fires only when the venue or period changes, so an existing PENDING request inside a new block is not
  re-checked. **Known risk:** until SCRUM-106 (flags the booking) and SCRUM-104's approve guard are merged, such a request can still
  be approved. Merge 106 straight after 105.
- Order in `submit()`/`change()`: the held-slot check runs first and the block check second, matching the trigger (booking
  overlap, then block). A request that is both held and blocked reports the held slot.
- The `activity_log` row is `entity_type = 'venue'`, `entity_id` = the venue (as `set_venue_timing`), `action_type =
  'venue_unavailability_marked'`.
- The seeded blocks (October 2026) predate any real use; the Playwright spec creates its own block through the app.

---

## SCRUM-105 Mark a Venue Temporarily Unavailable

**User story.** As Venue Staff, I want to mark a venue unavailable for a period and give a reason, so that it is not booked
while it cannot be used.

### Acceptance criteria

*AC1 (Scenario 1, marking a venue unavailable).* Given I am logged in as Venue Staff, when I mark "Orchid Hall" unavailable from
2026-11-14 08:00 to 2026-11-16 18:00 with reason "Maintenance", then the unavailability period is saved with its reason, my
identity and the time it was recorded, and it is shown on the "Orchid Hall" detail view.

*AC2 (Scenario 2, a reason is required).* Given I am marking a venue unavailable, when I submit without choosing a reason
(Maintenance, Equipment failure, Renovation, Safety concern, or Other), then a validation message is shown and nothing is saved.

*AC3 (Scenario 3, the end must follow the start).* Given I am marking a venue unavailable, when I submit an end date/time that
is not after the start, then a validation message is shown and nothing is saved.

*AC4 (Scenario 4, new requests during the period are refused).* Given "Orchid Hall" is unavailable from 2026-11-14 08:00 to
2026-11-16 18:00, when an Event Coordinator requests "Orchid Hall" on 2026-11-15, 09:00-17:00, then the request is refused and
the message states the venue is unavailable from 14 Nov 08:00 to 16 Nov 18:00.

*AC5 (Scenario 5, setup time counts against the period).* Given the same unavailability period, and "Orchid Hall" has setup 30
minutes, when an Event Coordinator requests "Orchid Hall" on 2026-11-16, 18:15-20:00 (occupies from 17:45), then the request is
refused, and a request for 2026-11-16, 18:30-20:00 is created with status "Pending".

*AC6 (Scenario 6, only Venue Staff can mark a venue unavailable).* Given I am logged in as an Event Coordinator, when I open
"Orchid Hall", then the action to mark it unavailable is not available to me.

### Notes from Jira

Week 7 Change 2. An unavailability period has no setup or turnaround of its own. A booking's padded time from SCRUM-103 is
compared against it. Existing bookings are handled in SCRUM-106 (C2-2).

### Interaction with other stories

- **SCRUM-103.** The padded overlap trigger (27) and `available_venues` (18, 27) are re-created in migration 38 from their latest
  bodies; the header comment lists their history. SCRUM-103's database tests stay green on this branch.
- **SCRUM-102.** `change_venue_booking()` updates the period in place, so the trigger fires: a change into a block is `CS105`.
  Moving a flagged booking out of a block is allowed (the target is outside it) and resolves its flag (SCRUM-106).
- **SCRUM-98.** The block check does not look at the event, so every booking of every event is checked the same way.
- **SCRUM-109 / 110.** Availability reported through the seam now includes blocks (above). Suitability of a booking is judged
  at submission only; a block made later does not rewrite it.
- **SCRUM-106 / 107.** 106 flags the bookings under a new block and notifies their coordinators, inside this story's RPC
  transaction. 107 offers the replacement. Neither changes this story's endpoint.
- **Seed.** The four seeded blocks stay as they are. They already read through `GET /venues/:id` and venue search.

### Tests

| ID | Scenario |
| --- | --- |
| 105-S1 | Venue staff mark Orchid Hall unavailable 14 Nov 08:00 to 16 Nov 18:00, Maintenance: 201; the row has the reason, `created_by` = Kenneth and `created_at`; `GET /venues/:id` lists it with "14 Nov 08:00" to "16 Nov 18:00"; an `activity_log` row exists (AC1). `parseUnavailabilityInput` unit tests: Singapore to UTC, trimmed notes. |
| 105-S2 | No reason, a blank reason, `internal_activity` and an unknown reason are 422 on `reason`; nothing is saved; the form shows the message; `mark_venue_unavailable` refuses the same with `22023`. Equipment failure, Safety concern and the rest save. Other without notes is 422 on `notes` [PROPOSED] (AC2). |
| 105-S3 | An end equal to or before the start is 422 on `endTime` and nothing is saved; malformed and impossible dates are 422 per field; the database check and the function refuse it too (AC3). |
| 105-S4 | With the block in place, a request for 15 Nov 09:00 to 17:00 is `409 VENUE_UNAVAILABLE` with exactly "Orchid Hall is unavailable from 14 Nov 08:00 to 16 Nov 18:00", nothing inserted, no reason in the body; the pre-check and the database trigger give the same message; changing a booking into the block (SCRUM-102) and amending (SCRUM-60) are refused the same way; a held slot is still `SLOT_CONFLICT` (AC4). |
| 105-S5 | Setup 30: 16 Nov 18:15 to 20:00 is refused; 18:30 to 20:00 is created Pending; with turnaround 30, a booking ending 08:00 on 14 Nov is refused and one ending 07:30 is created; venue search (`available_venues`) agrees with both (AC5). |
| 105-S6 | A coordinator: `can_mark_unavailable` is false, the page shows no form, `POST` is 403 (also with an invalid body); `mark_venue_unavailable` is `42501`; an organiser and an attendee get 403 from `/venues`; 404 for an unknown venue; 401 without a session (AC6). |
| 105-S7 | The blanket policy is gone: a coordinator reads the blocks but a direct insert, update or delete is denied; an organiser reads none; the seeded blocks still show (AC1, AC6). |
| 105-S8 | `venue_unavailability_conflicts` returns the overlapping blocks for staff and coordinators only and no reason; `available_venues` v3 excludes a venue whose padded request touches a block and keeps one that only touches it. |
| Race | 20 rounds of `mark_venue_unavailable` against a request for the same venue and period: each round ends with the request refused `VENUE_UNAVAILABLE`, or created and then inside the block (to be flagged by 106); never a deadlock error. |
| E2E | Kenneth marks Orchid Hall unavailable and sees it on the detail page; Rachel sees it with no form and her request for 15 Nov is refused with the exact message (AC1, AC4, AC6). |

### Out of scope

- Flagging or notifying for bookings already inside a block (SCRUM-106), replacing a booking (SCRUM-107).
- Editing, shortening or deleting a block. Jira has no scenario for it; a mistaken block needs a later story. **[PROPOSED]**
- Recurring blocks, and blocks that cover several venues at once.
- Choosing `internal_activity` for a new block.

### Open questions for the product owner

1. **Notes required when the reason is Other?** Proposed: yes, so an unexplained period never exists. Jira only says the reason is required.
2. **Should the refusal say why?** Proposed: no. The message gives the period only, as Jira writes it ("states the venue is
   unavailable from 14 Nov 08:00 to 16 Nov 18:00"), because a reason such as "Safety concern" can be sensitive.
3. **Can coordinators read a block's reason and notes?** Proposed: they see the period and the reason label; `notes` and `recordedBy` are staff only (the service leaves them
   out of the coordinator's response; row-level security cannot hide a single column, so the table stays readable to both roles).
4. **May a block start in the past?** Proposed: yes (a venue can break today).
5. **How does Venue Staff undo a mistaken block?** Not in this story. Proposed: a later story.
