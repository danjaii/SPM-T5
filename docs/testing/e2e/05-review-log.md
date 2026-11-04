# E2E review log

Every automated E2E test was drafted by an AI (Claude Code). A test counts as human-reviewed only when a named person fills
**Reviewer** and **Date** and ticks the human checks. This file is not filled in on anyone's behalf: Reviewer, Date and the
human checks stay blank until a person does them.

How rows get here: the AI adds a row when it writes a test and records the self-checks it actually ran. The generator in
`scripts/e2e` (Phase 5) adds rows for new test IDs and keeps every existing row as it is.

**Checks.** AI self-checks are what the drafting AI ran and can show. Human checks are for the reviewer:
- H1 the assertions match the acceptance criterion in the spec or Jira story;
- H2 the test is not tautological (it would fail if the behaviour were wrong);
- H3 a negative or boundary case is present where the AC has one;
- H4 the test-the-test record below is believable (re-run it if in doubt).

| Test ID | Drafted by | Reviewer | Date | AI self-checks | Human checks (H1-H4) | Changes made in review |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-ACL-01 | AI (Claude Code) | | | Passed locally (2026-11-04) on a freshly reset database. Negative cases: every other role's guarded page and dashboard is refused (redirect checked for each, visible "no access" page once per role). Positive controls: each role opens its own dashboard and a page it owns. Owners table is written out in the spec, not imported from the app. Test-the-test: see T1 and T2. | | First version loaded every refused page in the browser and timed out (240 s) once dashboards rendered fully; revised to check the guard's redirect per URL plus one real navigation per role. |
| E2E-CONF-01 | AI (Claude Code) | | | Passed locally (2026-11-04). Negative case is the point (refusal, nothing created, checked in the database); runs for a Pending and an Approved holder and for an overlap at each end. Test-the-test: T4. | | Catalogue text corrected: the plan quoted the old SCRUM-36 message; spec 103 replaced it with "<venue> is occupied from HH:MM to HH:MM" (no suffix at a venue without buffers, 103-S6). |
| E2E-CONF-02 | AI (Claude Code) | | | Passed locally (2026-11-04). Two refused periods (12:30-14:00, 08:00-08:50) with the exact occupied-period message; database check that nothing was created. Test-the-test: T3, T4, T5. | | |
| E2E-CONF-03 | AI (Claude Code) | | | Passed locally (2026-11-04). Boundary: padded periods that only touch are accepted; the new booking is checked in the database (one row, Pending). Test-the-test: T5. | | |
| E2E-EQP-01 | AI (Claude Code) | | | Passed locally (2026-11-04). Six steps on one item: 10 free; reserve 4 -> "6 still available"; overlapping period shows 6; a period starting exactly when the reservation ends shows 10 (boundary); a second reservation in the afternoon leaves 6 for the whole day (peak, not sum); the last 6 are reserved and the item then reports Insufficient. Database check of the three reservations (4, 4, 6, status reserved). Test-the-test: T6, T7. | | The event needs equipment work attached or Technical Support cannot see it (RLS `event_has_technical_work`); the spec arranges that with a plain request for another item. |

## Test-the-test records

A P0 test is run against a deliberately broken app, to see it fail. The break is made in the working tree only, never
committed, and is reverted with `git checkout`.

| Ref | Test ID | Date | Break made | Result | Reverted |
| ----- | ----- | ----- | ----- | ----- | ----- |
| T1 | E2E-ACL-01 | 2026-11-04 | Deleted the `/safety-checks` entry from `ROLE_ONLY` in `apps/web/src/lib/roleAccess.ts`, so nobody is refused that page | **Failed as it should**: "event_organiser opening /safety-checks ... Expected /access-denied, Received http://localhost:3000/safety-checks" | Yes, `git checkout apps/web/src/lib/roleAccess.ts`; `git status` clean |
| T2 | E2E-ACL-01 (revised version) | 2026-11-04 | Same break as T1, repeated because the test was rewritten after T1 | **Failed as it should**: "event_organiser requesting /safety-checks ... Expected >= 300, Received 200" | Yes, `git checkout apps/web/src/lib/roleAccess.ts`; only the spec file remained modified |
| T3 | E2E-CONF-02 | 2026-11-04 | In the local database, `venue_padded_period()` rewritten to ignore setup and turnaround (periods become plain [start, end)) | **Failed as it should**: 12:30-14:00 no longer refused ("element(s) not found" for the refusal). CONF-01 and CONF-03 still passed, as they do not depend on buffers | Yes: original function re-applied, definition compared identical to the saved original |
| T4 | E2E-CONF-01, E2E-CONF-02 | 2026-11-04 | In the local database, `venue_slot_conflicts()` made to return no rows and trigger `venue_bookings_padded_overlap` disabled (overlaps are never detected) | **Failed as it should**: both tests saw no refusal ("element(s) not found"). CONF-03 still passed, as it expects acceptance | Yes: function re-applied (identical to original), trigger re-enabled (`tgenabled = O`) |
| T5 | E2E-CONF-03 (also CONF-01, CONF-02) | 2026-11-04 | In the local database, `venue_padded_period()` given one extra minute of padding each side, so periods that only touch overlap | **Failed as it should**: CONF-03 was sent back to the request form (expected /venue-bookings/..); CONF-01 and CONF-02 failed too, as the message showed 09:59-12:01 and 09:29-12:46 instead of the exact periods | Yes: as T3 |
| T6 | E2E-EQP-01 | 2026-11-04 | `COUNTED_STATUSES` in `services/equipment-service/src/services/availabilityService.ts` changed from approved + reserved to approved only, so a reservation no longer reduces availability | **Failed as it should**: expected "6 available", received "10 available, on 2031-11-14, 10:00 to 13:00" | Yes, `git checkout` of the file; `git diff` on services is empty |
| T7 | E2E-EQP-01 | 2026-11-04 | Same file: the peak calculation replaced by a plain sum of every booking's units | **Failed as it should**: whole day expected "6 available", received "2 available, on 2031-11-14, 09:00 to 17:00" | Yes, as T6 |

The database breaks in T3-T5 were made with `docker exec ... psql` on the local Supabase only, after saving the exact original
definitions, and undone the same way; no migration file was added or changed and nothing touched the hosted project.
