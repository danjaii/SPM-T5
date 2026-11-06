# SCRUM-97 and SCRUM-108: tentative holds expire, and the coordinator is warned

Stories: SCRUM-97 (Venue Staff: every hold has an expiry and lapses), SCRUM-108 (Event Coordinator: warned before and when a hold
expires). Source: Week 7 change 4; the Week 9 answers Q9, Q26, Q29, Q40, Q44, Q54-Q56 (`docs/customer-requirements/07-clarifications-week9.md`).
The acceptance criteria are the Jira text plus `.local/SCRUM-97-108-ac-update.md` (the updated scenarios).

## What a hold is
A PENDING venue booking request (`venue_bookings.status = 'requested'`) is the tentative hold; an APPROVED one is the confirmed
booking (`docs/specs/venue-booking-request.md`). Holding statuses are `requested`, `tentative`, `approved`, `confirmed`.

## Decisions (customer answers, the team's, and mine where the docs are silent)
| # | Decision | Source |
| --- | --- | --- |
| D1 | Venue Staff set and update the expiry per hold, when they receive the request. No default expiry. | Q29, Q44, Q54 (B) |
| D2 | An expired hold frees the slot. It is never treated as confirmed; the coordinator submits a new request. | Q26 |
| D3 | "Expired" is derived from the time: no new status, no job that flips rows. Time comes from an injectable clock (service) and `now()` (database). | team |
| D4 | Rows that have no expiry are left exactly as they are: they hold the slot until decided or withdrawn. | team |
| D5 | Venue Staff can extend or shorten a live hold, and the event's coordinator is notified. An expired hold cannot be extended. | Q40, Q56 |
| D6 | The coordinator sets the warning time per hold, in whole minutes before expiry. Default 24 hours (a team assumption, one column default and one shared constant). | Q9, SCRUM-108 note |
| D7 | Expiry notifications ("expires in N", "expired") come from a periodic check that is idempotent: each notification is written once per hold and expiry time. | Q55, Week 7 change 4 |
| D8 | **My choice (docs silent):** an expiry must be in the future and not after the event starts. A hold that outlives its event means nothing. | Jira example (expiry weeks before the event) |
| D9 | **My choice:** when a request is changed or amended and goes back to PENDING, its expiry and warning bookkeeping are cleared. A changed request is a new request for Venue Staff to hold. | SCRUM-59, 102 |
| D10 | **My choice:** approving a PENDING request that never had an expiry set stays allowed (D4). | team |
| D11 | The API shows a lapsed hold as status `EXPIRED` (derived, with `holdExpiresAt`); the database status stays `requested`. | Jira SCRUM-97 scenario 4 |

## Out of scope (recorded, not built)
Equipment requests and technical assignments tied to a lapsed hold are not released automatically (the existing behaviour for any
non-holding booking applies). Email and push (in-app only, as the notification system stands). A scheduler outside the database.

## Mechanism
- `venue_bookings.hold_expires_at timestamptz null` and `hold_warning_minutes int not null default 1440` (migration 87).
- One SQL function, `venue_booking_holds_slot(status, hold_expires_at, now)`, says whether a booking still holds its slot. Every place
  that listed the holding statuses now calls it: `venue_slot_is_held`, `venue_slot_conflicts`, `venue_occupied_periods`,
  `available_venues` and the padded-overlap trigger.
- `set_hold_expiry(booking, expires_at)`: security definer, Venue Staff only. Errors (SQLSTATE class HE): HE001 the expiry is missing,
  not in the future or after the event starts; HE002 not a PENDING request; HE003 the hold has already expired.
- A guard refuses approving an expired hold (`CS097`, mapped to `HOLD_EXPIRED`), so the service role cannot bypass it.
- `set_hold_warning(booking, minutes)`: the event's assigned coordinator only.
- Notifications are written by database functions in the same transaction as the change (ADR 0002); the periodic check calls
  `notify_hold_expiries()`.

## Acceptance criteria and where each is tested
See the AC to test table in `.local/SCRUM-97-report.md` and `.local/SCRUM-108-report.md`.

## SCRUM-108 acceptance criteria (Jira: eight scenarios; test names cite `SCRUM-108/AC<n>` with these numbers)
**User story:** As an Event Coordinator, I want to be warned before and when a tentative hold on my event's venue expires, with a warning time I choose for each hold, so that I can confirm it in time or arrange another venue.

**AC1** Set the warning time per hold (default 24 h). Given a tentative hold on a venue for an event I coordinate, when I set a warning time for that hold (for example 24 hours before it expires), then it is saved against that hold; a new hold starts at 24 hours until I change it.

**AC2** Warning shown when expiry is near. Given "Orchid Hall" is held for "Summit A", which I coordinate, expiring 2026-11-01 17:00, and the time is 2026-11-01 09:00 (inside the hold's warning window), when I open my venue booking requests, then the hold shows "Hold expires in 8 hours".

**AC3** No warning while expiry is still far off. Given the same hold and the time is 2026-10-30 09:00 (outside its warning window), when I open my venue booking requests, then no expiry warning is shown (and none is written).

**AC4** Notified once when the warning time is reached. Given the warning time has been reached and the hold is still unconfirmed, then I receive one in-app notification saying the hold on "Orchid Hall" for "Summit A" expires in N hours; later checks do not write it again.

**AC5** Expired hold is flagged in the list and notified once. Given the hold expired at 2026-11-01 17:00 unconfirmed, when I open my venue booking requests, then "Orchid Hall" shows "Hold expired, venue no longer reserved", and I received one notification that it expired, the venue is no longer reserved and I must submit a new request.

**AC6** Confirmation clears the warning and stops notifications. Given a hold that showed a warning, when it is confirmed before expiry, then no warning is shown and no further notification is sent.

**AC7** Only the event's coordinator is warned or notified. Given "Summit A" is coordinated by someone else, when I open my venue booking requests, then I see no warning about its hold and receive no notification about it.

**AC8** Expiry changed by Venue Staff. Given Venue Staff change the hold's expiry, then I am notified of the new expiry and the warning is recalculated from it (shared with SCRUM-97's extension scenario).

**Decision (one configurable window).** The 24-hour default is the single value `HOLD_WARNING_DEFAULT_MINUTES` (`packages/shared/src/holdExpiry.ts`) and the column default `hold_warning_minutes` in migration 88, so a different answer from the customer is a one-line change.
**Decision (how the scenarios map to the code).** AC2, AC3 and the list half of AC5 are `holdNotice()` (`apps/web/src/lib/holds.ts`), shown on My venue bookings (a Hold column), the booking detail page (with the AC1 hours input) and the event page's booking card (`holdCountdown(expiresAt, now, warningMs)`, "Hold expires in N hours", "Hold expired, venue no longer reserved"); AC4 and the notification half of AC5 are `notify_hold_expiries()` run every minute by notification-service (the periodic-check tests cite AC4 and AC5); AC1 is `set_hold_warning()` and `PUT /venue-bookings/:id/hold-warning`.
