# E2E test plan

Plan for browser-driven end-to-end tests of ConnectSphere with Playwright. Facts about the repo are in
[00-discovery.md](00-discovery.md). Status: **built under SCRUM-191. All 68 cases have a spec; the latest results are in [metrics.md](metrics.md).** This file records the
plan and the decisions; where a case changed while it was written, the row below says what it checks now.

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
- field-level validation messages (for example every malformed date in `19-S8`). This plan is the lean version: E2E keeps
  the critical paths and the rule-based conflict, change and access cases a user sees as an outcome, not each message;
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
| E2E-JRN-01 | Organiser drafts, saves, resumes and submits a request; Lead assigns; Coordinator approves, moves it to Planning, searches venues, checks suitability and books; Venue Staff approve; the coordinator adds equipment and Technical Support arrange it; the Safety Officer approves; Coordinator confirms; Attendee registers and withdraws; Organiser raises a change request. One `test.step` per stage, one context per person; after each stage the notification recipients are checked against spec 47/172. (Not exercised: the Reserve equipment page, 19-S1, covered by E2E-EQP-01; the unsuitable-venue override, SCRUM-110, covered by E2E-VEN-02.) | 49, 53, 54, 77, 78, 24 (AC to confirm), 65, 109, 32, 38-S1, 86-88, 171, 99-AC5, 83, 73, 66-S6, 47 | P0 | N | 2-6, 10-13, 15, 18-20 | C5, C6 |

### AUTH and ACL

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-AUTH-01 | Signing in through the form lands each of the 7 roles on its own home | SCRUM-122/AC1 | P1 | N | 1 | |
| E2E-AUTH-02 | Wrong password, and a role that does not match the account, are refused with a message and no session | SCRUM-122/AC2 | P1 | F | 1 | |
| E2E-AUTH-03 | A guarded page without a session goes to `/login`; the register page keeps `?next=` and returns there after sign-in | SCRUM-177/AC2 | P1 | A | 1 | |
| E2E-AUTH-04 | Logout ends the session and Back does not reopen a guarded page | SCRUM-17/AC1-AC4 | P2 | N | 1 | |
| E2E-AUTH-05 | For each role the home page shows the shared sidebar with its home item highlighted once, and at 375 px the navigation collapses into a menu without sideways scroll | SCRUM-121/AC1, AC3 | P2 | N | 1 | |
| E2E-AUTH-06 | At 375 px the sign-in page does not scroll sideways and a person can still sign in | SCRUM-122/AC8 (the shared 375 px criterion; the plan said SCRUM-177) | P2 | B | 1 | |
| E2E-ACL-01 | For each role, opening a URL guarded for another role lands on "You don't have access to this page" | SCRUM-122/AC3, 77-AC7, 78-AC9 | P0 | A | 1 | C5 |
| E2E-ACL-02 | Calling a service with the wrong role's cookie gets 403 (and no session gets 401), and nothing changes: Lead queue and assign, booking approve and reject, safety decision, venue bookings of an event, equipment reservation | 77-AC7, 78-AC9, 98-S28, 19-S13, 39-S7, SCRUM-99/AC7 | P0 | A | 1 | C5 |
| E2E-ACL-03 | A coordinator cannot open or act on an event assigned to another coordinator | 156-S1, 156-S8, 102-S21 | P1 | A | 5 | C5 |
| E2E-ACL-05 | A coordinator the event is not assigned to cannot request a venue for it or list its bookings: 404 and no booking (spec 98 was changed from 403 when defect D-002 was decided) | 98-S26, 98-S27 | P1 | A | 12 | C3, C5 |
| E2E-ACL-04 | The organiser and the assigned coordinator see every registrant's name, email and phone; another coordinator gets neither the rows nor the details; a person still sees their own | SCRUM-154/AC3-AC5 | P2 | A | 1 | |

### EVT, ASSIGN: requests and assignment

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-EVT-01 | Organiser fills the 6-step form and submits; the request shows as Submitted in My event requests | SCRUM-49/AC1, SCRUM-52 | P1 | N | 2 | |
| E2E-EVT-02 | Save as draft, leave, resume from the Drafts tab, edit, submit | SCRUM-53, 54, 124 (124 AC to confirm) | P1 | N | 3 | |
| E2E-EVT-03 | Coordinator starts review, requests clarification, then rejects with a reason; another request is approved; organiser sees each status and reason | SCRUM-24, 44, 45 (AC to confirm) | P1 | N | 4, 6 | |
| E2E-EVT-04 | Coordinator edits details: a minor edit saves; a critical edit (date) shows the affected arrangements, and "Save anyway" sends them back to Pending | 111, 112-S8, 112-S14, 113-S1, 113-S9 | P1 | N | 7 | |
| E2E-EVT-05 | Cancelling needs a reason (the browser and the service refuse an empty one); the event's venue booking and equipment are released, its open change request is closed, the organiser and the still-registered attendees are told (not a withdrawn one, nor the coordinator), and it stays cancelled. Added after the brief and the customer's Week 9 answers were checked | 174-S1, S2, S3, S5, S7, S9, S10 | P1 | N | 6, 12, 15, 19, 20 | |
| E2E-ASSIGN-01 | Lead's queue lists unassigned submitted requests oldest first with the required columns; assigning removes the request from the queue and shows the coordinator on the event | 77-AC1-AC4, 78-AC2, 78-AC3 | P1 | N | 5 | C5 |
| E2E-ASSIGN-02 | Lead reassigns; the old coordinator loses access, the new one gains it and is told; the replaced coordinator and the Lead are not | SCRUM-79, 156-S4, 47-S1 | P1 | N | 5 | C5 |
| E2E-ASSIGN-03 | A second Lead assigns the event while the first has the page open; the first confirm is refused with "already assigned" and the assignment is unchanged | 78-AC5 | P1 | C | 5 | C5 |
| E2E-ASSIGN-04 | Both Leads see an unassigned request; the overview lists the coordinators of both Leads; a Lead assigns to the other Lead's coordinator and sees it on that coordinator's page. (The empty-queue message is not here, see section 5.) | 184-S1, 184-S2, 184-S3 | P2 | N | 5 | C5 |
| E2E-ASSIGN-05 | The Lead's Active events list shows every active assigned event, earliest first, not unassigned or closed ones; filters by coordinator, status and name; says when nothing matches; Leads only | SCRUM-189/AC1-AC6 | P1 | N | 5 | C5 |

### VEN, BOOK, CONF: venues, bookings and conflicts

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-VEN-01 | Venue search by date, time, people and location returns only matching venues; Reset clears (layout, accessibility, facility and capacity are E2E-VEN-07) | SCRUM-65 (17 scenarios) | P1 | N | 8, 10 | |
| E2E-VEN-02 | Suitability report shows Suitable, Not suitable, Not met, Check manually; an unsuitable venue needs a reason to go ahead | 109, 110 | P1 | N | 11 | |
| E2E-VEN-03 | Venue Staff add a venue and edit it; a coordinator cannot | SCRUM-57, 58, 155 | P2 | N | 8 | |
| E2E-VEN-04 | Venue Staff add, rename and delete a room layout type | SCRUM-181 | P2 | N | 8 | |
| E2E-VEN-05 | Venue Staff save 30 and 45 minutes; the calendar shows Setup 09:30-10:00, Event 10:00-12:00, Turnaround 12:00-12:45 | 101, 103-S5 | P1 | N | 8, 9 | C1 |
| E2E-VEN-06 | The venue calendar shows a Pending request as Tentatively Held and an Approved booking as Confirmed to Coordinators, Venue Staff and Technical Support, and refuses the Lead and the Safety Officer. Books tomorrow, not 2031: the calendar only steps a day at a time from today | SCRUM-84/AC2, AC8, SCRUM-130/AC1 | P2 | N | 9 | |
| E2E-VEN-07 | The layout, Accessible venue, facility and people filters each narrow the venues, and together keep only the venue that meets all of them | 65-S2, S3, S5 | P1 | N | 8, 10 | |
| E2E-VEN-08 | A venue without the event's layout is Not suitable (layout line Not met); the facilities line says Not checked, because the event stores no required facilities (see section 5); a venue with the layout is Suitable | 109-S1, S3 | P1 | N | 11 | |
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
| E2E-HOLD-01 | Venue Staff set a hold expiry and the coordinator is warned; while it is live nobody else can have the slot; once it lapses the slot is free for another event, the lapsed hold cannot be approved, and the coordinator is told it expired once. The lapse is made by moving the stored expiry into the past with the service key (expiry is derived from the time, and the screen refuses a past expiry) | SCRUM-97, SCRUM-108/AC2, AC5, AC7 | P1 | C | 9, 12, 14, 20 | C4 |

### CHG: change handling

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-CHG-01 | Raising buffers to 30/45 flags two existing bookings that now clash, each naming the other, and removes neither; Approve is hidden on a flagged Pending one; lowering to 15/15 clears both flags | 104-S1, 104-S2, 104-S4, 104-S5 | P1 | C | 14 | C1 |
| E2E-CHG-02 | Venue Staff mark a venue unavailable with a reason; the booking inside it is flagged, still Approved, and its coordinator (and only them) gets one notification | 105-S1, 106-S1, 106-S2, 106-S5 | P1 | N | 9, 20 | C2 |
| E2E-CHG-03 | Coordinator finds a replacement for the flagged booking, the candidates exclude venues that clash; the replacement is requested, Venue Staff approve it, the original shows "Replaced by ..."; a rejected replacement leaves the original flagged | 107-S1, 107-S2, 107-S3, 107-S4 | P1 | N | 12, 19 | C2 |
| E2E-CHG-04 | Raising attendance past the venue's capacity lists the venue booking in the warning; going back changes nothing; "Save anyway" saves and sends the booking back to Pending | 112-S4, 112-S13, 112-S14, 113-S1 | P1 | N | 7, 19 | |
| E2E-CHG-05 | Organiser submits a change request; the coordinator approves one and rejects another with a reason; the organiser sees both outcomes | 66-S1, 66-S6, 66-S7, SCRUM-67 | P1 | N | 19 | |
| E2E-CHG-06 | A second change to the same field while one is pending is refused and says so; a different field is accepted | 176-S1, 176-S4, 176-S8 | P1 | C | 19 | |
| E2E-CHG-07 | A block over a Confirmed event's venue returns it to Planning and tells its coordinator; lifting the block clears the flag and tells the coordinator. (The replacement-confirmed notice is E2E-NOTIF-03.) | SCRUM-185/AC1, AC2 | P2 | N | 9, 19 | C2 |
| E2E-CHG-08 | Moving an event's date lists its Arranged equipment request next to its venue booking; Go back changes nothing; Save anyway sends both back for review | 112-S8, 113-S1, 113-S3 | P1 | N | 7, 15, 19 | |

### EQP, SAFE: equipment and safety check

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-EQP-01 | 10 units, 4 reserved for an overlapping period: availability shows 6 and a reservation for 6 succeeds; 4 reserved in the morning and 4 in the afternoon leave 6 for the whole day (peak, not sum) | 18-S1, 19-S1, 19-S3, 19-S11 | P0 | C | 16, 17 | |
| E2E-EQP-02 | Asking for 8 when 6 are available is refused with the shortfall and saves nothing | 18-S3, 19-S4 | P1 | F | 16, 17 | |
| E2E-EQP-03 | The coordinator adds an equipment item against an approved venue booking (Submitted); Technical Support set it to Cannot Fulfil with a reason, which the coordinator sees on the Equipment tab. (The Arranged path is in E2E-JRN-01.) | SCRUM-86, 87, 88 | P1 | N | 15 | |
| E2E-EQP-04 | Technical Support add, edit and mark equipment under maintenance; it drops out of availability | SCRUM-182 | P2 | N | 15 | |
| E2E-SAFE-01 | An event with all arrangements complete shows in the Safety Officer's queue with attendance, capacity, layout, emergency access, accessibility, equipment placement and restrictions; an incomplete one does not | 99-AC1, 99-AC2, 99-AC3 | P1 | N | | C6 |
| E2E-SAFE-02 | Request changes with comments: the event returns to Planning, the coordinator is told, and the decision is recorded with officer, time and comments | 99-AC4, 99-AC8, SCRUM-100, 171 | P0 | F | | C6 |
| E2E-SAFE-03 | Reject without a reason is refused; with a reason the event cannot proceed | 99-AC6 | P1 | F | | C6 |
| E2E-SAFE-04 | Before an Approve, nobody can confirm the event (the coordinator's confirm is refused with the safety message) | 99-AC7 | P1 | A | 6 | C6 |
| E2E-SAFE-05 | Approve, then the coordinator confirms; the event shows Confirmed and "Safety Approved" | 99-AC5, 99-AC8 | P1 | N | 6 | C6 |
| E2E-SAFE-06 | An important change to a Confirmed event revokes its Safety Approval: the event waits for a new check and cannot be confirmed without it (customer Week 9) | SCRUM-100/AC9 | P1 | F | 6, 7 | C6 |

### REG, NOTIF: attendees and notifications

| ID | Scenario | Refs | Pri | Type | Feat | Chg |
| ----- | ----- | ----- | ----- | ----- | ----- | ----- |
| E2E-REG-01 | Attendee browses Confirmed events, registers, and sees the registration in My registrations; the organiser and coordinator see the attendee in the event's registrations | SCRUM-83, 72 (AC to confirm) | P1 | N | 18 | |
| E2E-REG-02 | Attendee withdraws from My registrations after confirming; the registration shows Withdrawn and a withdrawn attendee is not on the active list | SCRUM-73 | P1 | N | 18 | |
| E2E-REG-03 | Event with capacity 1: the first attendee registers, the second is told the event is full (or is put on pending, as SCRUM-169 decides) | SCRUM-169 (AC to confirm) | P1 | B | 18 | |
| E2E-REG-04 | While an event is back in Planning, registration is closed and the coordinator can adjust capacity and window | SCRUM-185/AC4 | P2 | B | 18 | C2 |
| E2E-REG-05 | A further attendee at a full event waits for the organiser, who cannot Confirm while it is full, can Decline, and can add a VIP past the cap up to the venue's capacity | SCRUM-169/AC3, AC4, SCRUM-170 | P1 | B | 18 | |
| E2E-REG-06 | On a full event with an attendee waiting for the organiser, the organiser adds a VIP: the VIP must appear in the list without a reload. **Skipped in the production build** while the intermittent defect D-006 is open; it runs under `next dev` | SCRUM-170 | P1 | B | 18 | |
| E2E-NOTIF-01 | The bell shows the unread count; the page lists notifications with unread ones marked in words; Mark as read changes one (the bell follows after a reload); opening one goes to what it is about and marks it read. (Acknowledge is not covered: it needs an action-needed notification.) | SCRUM-46 | P1 | N | 20 | |
| E2E-NOTIF-02 | One action sends one notification to the right user and none to others: assignment, approval, booking decision, venue flag | SCRUM-47, 172, 106-S5 | P1 | A | 20 | |
| E2E-NOTIF-03 | The replacement-confirmed notice reaches the organiser and the affected attendees, not a withdrawn one | SCRUM-185/AC3, SCRUM-172 | P2 | A | 20 | C2 |

**Counts** (counted from the tables above, lean scope): 68 cases. Priority: 8 P0, 48 P1, 12 P2. Type: 37 normal, 6 failure,
7 boundary, 9 conflict, 9 access-control. (E2E-ACL-05 was added during writing, when the unassigned-coordinator check turned out
to contradict spec 98; see defect D-002, since closed by changing the spec to 404.) The metrics script will recompute these from the catalogue file, which becomes the source.
Week 7 changes with at least one case: all six, C1 to C6 (C4, tentative hold expiry, was built by SCRUM-97 and SCRUM-108 on 2026-11-06 and is E2E-HOLD-01). The number of features covered
out of 20 is computed by the script from the Feat column; I have not hand-counted it.

## 4. Existing specs folded in

**Done (SCRUM-191):** every file below was folded into its case and then deleted; only `smoke.spec.ts` is left at the top of `tests/e2e`.
A fold was a rewrite onto the shared fixtures, not a copy: the old files signed in through the form for every test, repeated
their own REST helpers and ran only with `E2E_FULL_STACK=1`, and several had gone stale against `main` (the attendee's home item, the Lead's home).

Each file keeps its test logic, moves onto the shared fixtures (the old `label.role-option` sign-in is replaced by the
storageState or the combobox helper), loses its `E2E_FULL_STACK` gate and gets a catalogue ID.

| Existing file | Goes to |
| ----- | ----- |
| sign-in, logout, app-shell | AUTH-01 to AUTH-06 |
| users-contact-privacy | ACL-04 |
| lead-system-wide | ASSIGN-04 |
| event-change-request | CHG-05 (its form-validation tests, AC10 and similar, are not carried over: unit and integration cover them) |
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
| registration-settings | REG-04 |
| equipment-catalogue | EQP-04 |
| notifications | NOTIF-01 |
| smoke | stays as it is |

New tests (not in any old file): JRN-01, ACL-01 to ACL-03, EVT-01 to EVT-04, ASSIGN-01 to ASSIGN-03, VEN-01, VEN-06, BOOK-01, BOOK-02,
BOOK-04, BOOK-05, CONF-01, CONF-04, CHG-04, CHG-06, EQP-01 to EQP-03, SAFE-01 to SAFE-05, REG-01 to REG-03,
NOTIF-02.

## 5. What cannot be covered, and why

| Item | Reason | Where it is reported |
| ----- | ----- | ----- |
| ~~C4: hold expiry~~ (superseded) | It was not built when this plan was written; SCRUM-97 and SCRUM-108 built it on 2026-11-06 and E2E-HOLD-01 covers it. | Defect D-001 in `defects.md`, now closed. |
| Email and SMS notifications | Not built (ADR 0002; `notification-service` is read-only). | Uncovered. NOTIF cases check in-app only. |
| Exact-instant boundaries (registration closes at the second) and registration window closed / not yet open | Needs a frozen clock the whole stack shares; the closed and not-yet-open pages are display variants, not a critical path. | Left to unit and integration tests. |
| Field-level validation messages: event request form, change request form, equipment reservation form | Lean scope (agreed in plan review): E2E takes rules a user sees as a business outcome, not each message. Covered by unit tests and the service validation tests (`19-S6` to `19-S8`, `66-S2` to `66-S5`, `66-S10`, SCRUM-49). | Unit and integration tests. The failure and boundary types are still represented by the cases in the catalogue. |
| Suitability by a required facility (the brief's example "a required facility is unavailable") | An event stores no required-facilities field, so the check cannot produce "not available" (spec 109, "Only what is stored today is checked", decided 2026-10-14). E2E-VEN-08 asserts what the product does: the facilities line says Not checked. | Recorded in `docs/scope-decisions.md` ("Required facilities on an event"); defect D-004, closed. |
| Request amendments from the Organiser (the brief: "request clarification or amendments") | A "returned" status exists, but no screen in the review actions uses it; the review offers clarification, approve and reject. | Needs the team to say whether it is built; clarification is covered by E2E-EVT-03. |
| Empty Lead queue message (SCRUM-77/AC6) | The queue is system-wide (SCRUM-184) and other tests keep unassigned requests in it while this one runs, so it is never empty during a run. | The unit tests of `LeadQueueList`. |
| Back-to-back bookings with 0/0 setup (`103-S6`) | An edge variant of the touching-periods rule, which `CONF-03` already covers with real buffers. | Unit and integration tests. |
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

## 7. Where it stands

Built on branch `SCRUM-191/e2e-playwright` (Jira SCRUM-191): the config, fixtures and page objects, a spec for every case above, the CI `e2e` job,
and the generator in `scripts/e2e` that writes `02`, `03`, `04`, `metrics.md` and the new rows of `05` from a run. How to run and regenerate:
[README-e2e.md](README-e2e.md). What people still have to do: review every test (`05-review-log.md`) and run the manual scripts
(`02-test-cases.md`, Executed by blank in `04-execution-log.md`).
