# E2E test plan

Plan for browser-driven end-to-end tests of ConnectSphere with Playwright. Facts about the repo are in
[00-discovery.md](00-discovery.md). Status: **draft for review. No test code has been written.**

## 1. Scope and approach

**Why E2E.** The 5,111 Vitest tests prove each service and component on its own. None of them proves that a signed-in
person can walk a whole request through the real web app, five services and the database together, and that the
screens show the right thing to the right role. E2E exists for that, and for the rules the course grades by name: conflicts,
change handling, access control and notifications.

**E2E covers**
- the user journey across roles and services (one golden journey);
- rules whose result a user can see on screen: conflict refusals, flags, status changes, validation messages,
  notifications;
- role access: guarded URLs and wrong-role API calls.

**E2E leaves to unit and integration tests** (so it stays small and stable)
- exhaustive validation (for example every malformed date in `19-S8`); E2E takes one representative case;
- races and parallel writes (`36-S4`, `38-S3`, `19-S12`, `107-S5`) because they need exact timing;
- row-level security by table and column; E2E takes one wrong-role case per area (`ACL-02`);
- the exact-instant boundary of a time rule (registration window closing to the second). E2E seeds a window that closed a
  minute ago and one that opens tomorrow; the instant itself stays in the database tests;
- the content of emails and SMS (not built).

**Style**
- Locators by role, label or test id; web-first assertions; no `waitForTimeout`.
- Assertions are on what the user sees. Where the screen cannot prove a rule (a row was *not* removed, a notification was
  *not* sent to someone else), the test also reads the database or API with the service-role key.
- A journey that crosses roles uses one browser context per role.
- Chromium only.

## 2. Test data and environment

| Topic | Decision |
| ----- | ----- |
| Database | Local Supabase, migrations plus `seed.sql`. One `supabase db reset` before a suite run (asked first locally; CI always starts fresh). **Not** a reset per test: workers share the database. |
| Isolation | Each test creates its own rows with the service-role REST client (`E2E-<ID>-<rand>` names) and deletes them afterwards. A test asserts only on rows it created (CLAUDE.md, SCRUM-143). Where a test needs a count or a list, it uses its own organiser, venue and event. |
| Accounts | The seeded accounts in `00-discovery.md`. Setup logs in once per role and saves `storageState`. Roles that must act on a test's own data (for example "the assigned coordinator") are chosen by the test: it assigns its event to a seeded coordinator. |
| Time | Real clock. Seeded dates are far in the future (2030-2031), as in the existing specs. Window and flag rules are set by seeding timestamps around `now()`. No clock hook and no `NODE_ENV=test` branch, because the only rule that needs a frozen clock (hold expiry) is not built. |
| Services | The five services started from `dist/` and `next start`. Locally on ports 4101 to 4105, so the developer's own dev servers on 4001-4005 are left alone. In CI on 4001 to 4005. |
| Login | Through the API in setup (cookie `cs_session`). One test (`AUTH-01`) signs in through the real form for every role. |

## 3. Catalogue

IDs are `E2E-<AREA>-<nn>`. **Priority** P0 (must pass for the submission), P1, P2. **Type** N normal, B boundary,
C conflict, F failure, A access-control. **Feat** is the feature number from CLAUDE.md (1-20). **Chg** is the Week 7
change (C1-C6). Refs are real scenario IDs from `docs/specs/`; "AC" refs use `SCRUM-<story>/AC<n>`. Where a feature has no
written spec (see `00-discovery.md` section 10) the ref is the Jira story only and says "AC to confirm"; I will not invent ACs.

A case that folds in an existing spec file names the file in section 4.

### JRN: golden journey

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-JRN-01 | Organiser drafts, saves, resumes and submits a request; Lead assigns; Coordinator reviews and approves; finds a venue and checks suitability; books; Venue Staff approve; Technical Support arranges equipment; the event reaches Awaiting Arrangements by itself; Safety Officer approves; Coordinator confirms; Attendee registers and withdraws; Organiser raises a change request. One `test.step` per stage, one context per role, and after each stage the right user's notification is checked. | 49, 53, 54, 77, 78, 24/44 (AC to confirm), 65, 109, 110, 32, 38, 86-88, 19, 171, 99 AC5, 83, 73, 66, 47 | P0 | N | 1-6, 10-13, 15, 17-20 | C5, C6 |

### AUTH and ACL

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-AUTH-01 | Signing in through the form lands each of the 7 roles on its own home | SCRUM-122/AC1 | P1 | N | 1 | |
| E2E-AUTH-02 | Wrong password, and a role that does not match the account, are refused with a message and no session | SCRUM-122/AC2 | P1 | F | 1 | |
| E2E-AUTH-03 | A guarded page without a session goes to `/login`; the register page keeps `?next=` and returns there after sign-in | SCRUM-177/AC2 | P1 | A | 1 | |
| E2E-AUTH-04 | Logout ends the session and Back does not reopen a guarded page | SCRUM-17/AC1-AC4 | P2 | N | 1 | |
| E2E-AUTH-05 | The shared sidebar shows each role's own items and no others | SCRUM-121/AC1, AC3 | P2 | N | 1 | |
| E2E-AUTH-06 | Sign-in works at a 375 px wide screen | SCRUM-177/AC8 | P2 | B | 1 | |
| E2E-ACL-01 | For each role, opening a URL guarded for another role lands on "You don't have access to this page" | SCRUM-122/AC3, 77-AC7, 78-AC9 | P0 | A | 1 | C5 |
| E2E-ACL-02 | Calling a service with the wrong role's cookie gets 403, or rows that row-level security hides: Lead queue, booking decision, safety decision, equipment reservation, venue-booking list | 77-AC7, 78-AC9, 98-S26-S28, 19-S13, 39-S7, 156-S1 | P0 | A | 1 | C5 |
| E2E-ACL-03 | A coordinator cannot open or act on an event assigned to another coordinator | 156-S1, 156-S8, 102-S21 | P1 | A | 5 | C5 |
| E2E-ACL-04 | A coordinator's page shows other users' names but no contact details | SCRUM-154/AC3-AC5 | P2 | A | 1 | |

### EVT, ASSIGN: requests and assignment

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-EVT-01 | Organiser fills the 6-step form and submits; the request shows as Submitted in My event requests | SCRUM-49/AC1, SCRUM-52 | P1 | N | 2 | |
| E2E-EVT-02 | Required fields empty, end before start, attendance 0, registration closes before it opens: messages shown, nothing created | SCRUM-49 (ACs for validation) | P1 | F | 2 | |
| E2E-EVT-03 | Save as draft, leave, resume from the Drafts tab, edit, submit | SCRUM-53, 54, 124 (124 AC to confirm) | P1 | N | 3 | |
| E2E-EVT-04 | Coordinator starts review, requests clarification, then rejects with a reason; another request is approved; organiser sees each status and reason | SCRUM-24, 44, 45 (AC to confirm) | P1 | N | 4, 6 | |
| E2E-EVT-05 | Coordinator edits details: a minor edit saves; a critical edit (date) shows the affected arrangements, and "Save anyway" sends them back to Pending | 111, 112-S8, 112-S14, 113-S1, 113-S9 | P1 | N | 7 | |
| E2E-ASSIGN-01 | Lead's queue lists unassigned submitted requests oldest first with the required columns; assigning removes the request from the queue and shows the coordinator on the event | 77-AC1-AC4, 78-AC2, 78-AC3 | P1 | N | 5 | C5 |
| E2E-ASSIGN-02 | Lead reassigns; the old coordinator loses access, the new one gains it | SCRUM-79, 156-S4 | P1 | N | 5 | C5 |
| E2E-ASSIGN-03 | A second Lead assigns the event while the first has the page open; the first confirm is refused with "already assigned" and the assignment is unchanged | 78-AC5 | P1 | C | 5 | C5 |
| E2E-ASSIGN-04 | Empty queue shows the "no requests awaiting" message; a Lead sees events of every coordinator | 77-AC6, 184-S1 | P2 | B | 5 | C5 |

### VEN, BOOK, CONF: venues, bookings and conflicts

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-VEN-01 | Venue search by date, time, people, location, layout and facility returns only matching venues; Reset clears | SCRUM-65 (17 scenarios) | P1 | N | 8, 10 | |
| E2E-VEN-02 | Suitability report shows Suitable, Not suitable, Not met, Check manually; an unsuitable venue needs a reason to go ahead | 109, 110 | P1 | N | 11 | |
| E2E-VEN-03 | Venue Staff add a venue and edit it; a coordinator cannot | SCRUM-57, 58, 155 | P2 | N | 8 | |
| E2E-VEN-04 | Venue Staff add, rename and delete a room layout type | SCRUM-181 | P2 | N | 8 | |
| E2E-VEN-05 | Venue Staff save 30 and 45 minutes; the calendar shows Setup 09:30-10:00, Event 10:00-12:00, Turnaround 12:00-12:45 | 101, 103-S5 | P1 | N | 8, 9 | C1 |
| E2E-VEN-06 | Venue calendar shows Pending as tentatively held and Approved as booked, to the roles allowed to see it | SCRUM-84, 130 (AC to confirm) | P2 | N | 9 | |
| E2E-BOOK-01 | Coordinator requests a venue; it is Pending; Venue Staff see it in the queue and approve; the coordinator sees Approved | 32, 37-S1, 38-S1 | P1 | N | 12, 13 | |
| E2E-BOOK-02 | Venue Staff reject with a reason; the coordinator sees the reason on the booking; the reason is kept and the slot is free again | 39-S1, 39-S4 | P1 | F | 13 | |
| E2E-BOOK-03 | Venue Staff reject and suggest an alternative; the coordinator accepts it | SCRUM-40 | P1 | N | 13 | |
| E2E-BOOK-04 | An event with three bookings: each is checked on its own; cancelling one with a reason leaves the other two unchanged and the event status unchanged | 98-S1, 98-S17, 102-S12, 102-S20, 98-S24 | P1 | N | 12 | C3 |
| E2E-BOOK-05 | Changing an Approved booking sends it back to Pending; changing it into a clash is refused and changes nothing; moving it within its own period is allowed | 102-S2, 102-S4, 102-S6 | P1 | B | 12 | C3 |
| E2E-CONF-01 | A request overlapping another event's booking is refused with "This venue is already held for part of that period."; no booking is created | 36-S1 | P0 | C | 14 | |
| E2E-CONF-02 | Worked example: 10:00-12:00 with 30/45 minutes occupies 09:30-12:45; 12:30-14:00 is refused with "occupied from 09:30 to 12:45, including setup and turnaround"; 08:00-08:50 is refused | 103-S1, 103-S3 | P0 | C | 14 | C1 |
| E2E-CONF-03 | A request at 13:15-15:00 is accepted: the padded periods only touch | 103-S2 | P0 | B | 14 | C1 |
| E2E-CONF-04 | The same event asking for the same venue overlapping its own booking is refused as a duplicate; a different venue is fine | 98-S13, 98-S4, 103-S9 | P1 | C | 12, 14 | C3 |
| E2E-CONF-05 | A request into a venue's unavailable period is refused with the exact period; a request that only touches the padded block is accepted | 105-S4, 105-S5 | P1 | C | 14 | C2 |
| E2E-CONF-06 | With 0/0 setup, back-to-back bookings (end 12:00, start 12:00) are accepted | 103-S6, 98-S5 | P2 | B | 14 | C1 |

### CHG: change handling

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-CHG-01 | Raising buffers to 30/45 flags two existing bookings that now clash, each naming the other, and removes neither; Approve is hidden on a flagged Pending one; lowering to 15/15 clears both flags | 104-S1, 104-S2, 104-S4, 104-S5 | P1 | C | 14 | C1 |
| E2E-CHG-02 | Venue Staff mark a venue unavailable with a reason; the booking inside it is flagged, still Approved, and its coordinator (and only them) gets one notification | 105-S1, 106-S1, 106-S2, 106-S5 | P1 | N | 9, 20 | C2 |
| E2E-CHG-03 | Coordinator finds a replacement for the flagged booking, the candidates exclude venues that clash; the replacement is requested, Venue Staff approve it, the original shows "Replaced by ..."; a rejected replacement leaves the original flagged | 107-S1, 107-S2, 107-S3, 107-S4 | P1 | N | 12, 19 | C2 |
| E2E-CHG-04 | Raising attendance past the venue's capacity lists the venue booking in the warning; going back changes nothing; "Save anyway" saves and sends the booking back to Pending | 112-S4, 112-S13, 112-S14, 113-S1 | P1 | N | 7, 19 | |
| E2E-CHG-05 | Organiser submits a change request; the coordinator approves one and rejects another with a reason; the organiser sees both outcomes | 66-S1, 66-S6, 66-S7, SCRUM-67 | P1 | N | 19 | |
| E2E-CHG-06 | A second change to the same field while one is pending is refused and says so; a different field is accepted | 176-S1, 176-S4, 176-S8 | P1 | C | 19 | |
| E2E-CHG-07 | A block over a Confirmed event's venue returns it to Planning; lifting the block releases the flags; the replacement-confirmed notice reaches the organiser | SCRUM-185/AC1, AC2, AC3 | P2 | N | 9, 19 | C2 |
| E2E-CHG-08 | Change request form: nothing changed, attendance 0, end before start show messages and store nothing; a draft or cancelled event offers no form | 66-S2-S5, 66-S10 | P2 | F | 19 | |

### EQP, SAFE: equipment and safety check

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-EQP-01 | 10 units, 4 reserved for an overlapping period: availability shows 6 and a reservation for 6 succeeds; 4 reserved in the morning and 4 in the afternoon leave 6 for the whole day (peak, not sum) | 18-S1, 19-S1, 19-S3, 19-S11 | P0 | C | 16, 17 | |
| E2E-EQP-02 | Asking for 8 when 6 are available is refused with the shortfall and saves nothing | 18-S3, 19-S4 | P1 | F | 16, 17 | |
| E2E-EQP-03 | Organiser adds an equipment requirement on the event; Technical Support review it and move it to Arranged, or to a status with a reason | SCRUM-86, 87, 88 | P1 | N | 15 | |
| E2E-EQP-04 | Reserve equipment with no equipment, quantity 0, end before start: each message shown; equipment under maintenance cannot be selected | 19-S6, 19-S7, 19-S8, 19-S10 | P1 | F | 17 | |
| E2E-EQP-05 | Technical Support add, edit and mark equipment under maintenance; it drops out of availability | SCRUM-182 | P2 | N | 15 | |
| E2E-SAFE-01 | An event with all arrangements complete shows in the Safety Officer's queue with attendance, capacity, layout, emergency access, accessibility, equipment placement and restrictions; an incomplete one does not | 99-AC1, 99-AC2, 99-AC3 | P1 | N | | C6 |
| E2E-SAFE-02 | Request changes with comments: the event returns to Planning, the coordinator is told, and the decision is recorded with officer, time and comments | 99-AC4, 99-AC8, SCRUM-100, 171 | P0 | F | | C6 |
| E2E-SAFE-03 | Reject without a reason is refused; with a reason the event cannot proceed | 99-AC6 | P1 | F | | C6 |
| E2E-SAFE-04 | Before an Approve, nobody can confirm the event (the coordinator's confirm is refused with the safety message) | 99-AC7 | P1 | A | 6 | C6 |
| E2E-SAFE-05 | Approve, then the coordinator confirms; the event shows Confirmed and "Safety Approved" | 99-AC5, 99-AC8 | P1 | N | 6 | C6 |

### REG, NOTIF: attendees and notifications

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-REG-01 | Attendee browses Confirmed events, registers, and sees the registration in My registrations; the organiser and coordinator see the attendee in the event's registrations | SCRUM-83, 72 (AC to confirm) | P1 | N | 18 | |
| E2E-REG-02 | Attendee withdraws from My registrations after confirming; the registration shows Withdrawn and a withdrawn attendee is not on the active list | SCRUM-73 | P1 | N | 18 | |
| E2E-REG-03 | Event with capacity 1: the first attendee registers, the second is told the event is full (or is put on pending, as SCRUM-169 decides) | SCRUM-169 (AC to confirm) | P1 | B | 18 | |
| E2E-REG-04 | Registration window already closed, and not yet open: the page says so and offers no Register button | SCRUM-72 (AC to confirm) | P1 | B | 18 | |
| E2E-REG-05 | While an event is back in Planning, registration is closed and the coordinator can adjust capacity and window | SCRUM-185/AC4 | P2 | B | 18 | C2 |
| E2E-NOTIF-01 | The bell shows the unread count; the page lists notifications, "Mark as read" and "Acknowledge" change them, and "Open" goes to the item | SCRUM-46, 46-S1, S4-S7 | P1 | N | 20 | |
| E2E-NOTIF-02 | One action sends one notification to the right user and none to others: assignment, approval, booking decision, venue flag | SCRUM-47, 172, 106-S5 | P1 | A | 20 | |
| E2E-NOTIF-03 | The replacement-confirmed notice reaches the organiser and the affected attendees, not a withdrawn one | SCRUM-185/AC3, SCRUM-172 | P2 | A | 20 | C2 |

**Counts** (counted from the tables above): 63 cases. Priority: 8 P0, 41 P1, 14 P2. Type: 31 normal, 8 failure, 8 boundary,
8 conflict, 8 access-control. The metrics script will recompute these from the catalogue file, which becomes the source.
Week 7 changes with at least one case: C1, C2, C3, C5, C6. **C4 has no case (not built).** The number of features covered
out of 20 is computed by the script from the Feat column; I have not hand-counted it.

## 4. Existing specs folded in

Each file keeps its test logic, moves onto the shared fixtures (the old `label.role-option` sign-in is replaced by the
storageState or the combobox helper), loses its `E2E_FULL_STACK` gate and gets a catalogue ID.

| Existing file | Goes to |
| ----- | ----- |
| sign-in, logout, app-shell | AUTH-01 to AUTH-06 |
| users-contact-privacy | ACL-04 |
| lead-system-wide | ASSIGN-04 |
| event-change-request | CHG-05, CHG-08 |
| venue-add, venue-edit | VEN-03 |
| layout-types | VEN-04 |
| venue-timing, venue-padding | VEN-05, CONF-02, CONF-03 |
| venue-suitability, venue-request-suitability | VEN-02 |
| suggest-alternative | BOOK-03 |
| venue-buffer-conflicts | CHG-01 |
| venue-unavailability, venue-unavailability-flags | CHG-02, CONF-05 |
| replacement-venue | CHG-03 |
| venue-block-reverts-event, venue-block-lifting | CHG-07 |
| replacement-confirmed-notice | NOTIF-03 |
| registration-settings | REG-05 |
| equipment-catalogue | EQP-05 |
| notifications | NOTIF-01 |
| smoke | stays as it is |

New tests (not in any old file): JRN-01, ACL-01 to ACL-03, EVT-01 to EVT-05, ASSIGN-01 to ASSIGN-03, VEN-01, VEN-06, BOOK-01, BOOK-02,
BOOK-04, BOOK-05, CONF-01, CONF-04, CONF-06, CHG-04, CHG-06, EQP-01 to EQP-04, SAFE-01 to SAFE-05, REG-01 to REG-04,
NOTIF-02.

## 5. What cannot be covered, and why

| Item | Reason | Where it is reported |
| ----- | ----- | ----- |
| **C4: hold expiry**, expired hold releases the venue, coordinator notified at expiry, an expired hold is not a booking | Not built: no expiry column, sweeper or job; no UI creates a hold. | Defect D-001 in `defects.md`; shown as uncovered in the traceability matrix and metrics. Not in `scope-decisions.md` (no customer quote found). |
| Email and SMS notifications | Not built (ADR 0002; `notification-service` is read-only). | Uncovered. NOTIF cases check in-app only. |
| Exact-instant boundaries (registration closes at the second) | Needs a frozen clock the whole stack shares. | Left to integration tests; REG-04 covers closed and not-yet-open. |
| Concurrency (`36-S4`, `38-S3`, `107-S5`, `78` with two simultaneous confirms) | Needs exact timing; ASSIGN-03 covers the sequential version. | Integration tests. |
| "No eligible coordinator" (78-AC7) | Needs every coordinator inactive, which would change data shared with other tests. | Integration tests. |
| Features 1, 4, 6, 8, 18 acceptance criteria | No written spec in `docs/specs/`. | Cases cite the Jira story and say "AC to confirm" until you give me the Jira ACs. |
| Layout at screen sizes other than 375 px and desktop; other browsers | Out of scope for release 1. | Not reported. |

## 6. Risks

- **Slow check.** The `e2e` job gets a database, five services and a production build; expect 15 to 25 minutes, and an E2E
  failure blocks teammates' PRs because `e2e` is a required check.
- **Flaky cross-role tests.** Retries are 1 in CI so a flake is reported as "flaky" and not hidden. If JRN-01 flakes under
  parallel load it runs serially (stated in a comment in the file).
- **Windows `webServer`.** An earlier session found the old command failed on Windows. If `pnpm exec` also fails, the
  README documents starting the stack by hand and CI is unaffected.
- **Auth rate limit.** 300 sign-ins per 5 minutes locally; storageState from one setup run keeps tests well under it.
- **Shared dev database.** Other branches' migrations may be applied locally. Before a run I check
  `supabase migration list --local`; an unapplied migration makes tests fail in misleading ways.
- **Test data left behind** if a run is killed. Names carry the `E2E-` prefix so they can be found and removed.

## 7. What happens next

1. You review this plan, the catalogue, and the answers to the open questions at the end of `00-discovery.md`.
2. Phase 2 (infrastructure), on branch `test/e2e-playwright`, starting with the config, setup project and fixtures, and the
   `data-testid` hooks in their own commit.
3. Specs P0, then P1, then the folded-in P2, then CI, then the generated docs and metrics.
