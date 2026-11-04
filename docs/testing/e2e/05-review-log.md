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
| E2E-ACL-01 | AI (Claude Code) | | | Passed locally (2026-11-04). Negative cases: every other role's guarded page and dashboard is refused. Positive controls: each role opens its own dashboard and a page it owns. Owners table is written out in the spec, not imported from the app. Test-the-test: see T1. | | |

## Test-the-test records

A P0 test is run against a deliberately broken app, to see it fail. The break is made in the working tree only, never
committed, and is reverted with `git checkout`.

| Ref | Test ID | Date | Break made | Result | Reverted |
| ----- | ----- | ----- | ----- | ----- | ----- |
| T1 | E2E-ACL-01 | 2026-11-04 | Deleted the `/safety-checks` entry from `ROLE_ONLY` in `apps/web/src/lib/roleAccess.ts`, so nobody is refused that page | **Failed as it should**: "event_organiser opening /safety-checks ... Expected /access-denied, Received http://localhost:3000/safety-checks" | Yes, `git checkout apps/web/src/lib/roleAccess.ts`; `git status` clean |
