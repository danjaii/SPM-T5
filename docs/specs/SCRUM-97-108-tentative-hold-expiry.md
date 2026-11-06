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
