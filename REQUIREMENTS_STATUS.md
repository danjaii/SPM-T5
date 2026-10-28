# Requirements status: ConnectSphere vs the Week 1–10 customer requirements

- **Assessed:** 2026-10-28, `main` @ `8c5ee65` (level with `origin/main`)
- **Sources** (IS212 AY2026/27 T1 project folder): Week 1 Customer Briefing, Week 4 Project Instructions, Week 7 Customer Changes (PDF), Week 10 CFO/CTO AI Check
- **Method:** static review of migrations, service routes, web pages and tests, with spot checks of the highest-impact claims. **The test suite was not run**, so "tests exist" means the files exist, not that they pass.
- **Legend:** ✅ Met · 🟡 Partial · ❌ Not met
- **Precedence:** the Week 4 list of 20 core features is the release-1 scope. The Week 7 changes are all mandatory ("all of the suggested changes should be implemented"). Week 1 items outside the 20 are optional and only listed for information (section 8).
- Paths are relative to the repo root. `Mig/NN` means `supabase/migrations/NN_*.sql`.

## 1. Scoreboard

| Source | ✅ | 🟡 | ❌ |
| --- | --- | --- | --- |
| Week 4 core features (20) | 11 | 8 | 1 |
| Week 7 changes (6) | 4 | 1 | 1 |

**Biggest gaps, in order of risk to the Week 12 demo:**

1. **Week 7 #4, tentative holds expire: not built.** There is only a front-end countdown that never receives data. No expiry column, no release job, no notification, and the back end treats `tentative` as APPROVED. The only spec that mentions it scopes it out. It is mandatory.
2. **No draft event requests.** A request can only be created already submitted.
3. **Registrations never become Confirmed.** Every registration is saved Pending (`waitlisted`), and only Confirmed ones count toward capacity, so the capacity cap can never trigger.
4. **Status management has no transition rules, and cancel releases nothing.** Confirmed, Completed and Cancelled are reached through a free dropdown that accepts any status. Cancelling an event does not free its venue bookings or equipment, which the Week 1 briefing calls out as a problem to fix.
5. **Safety Officer "Reject" is a dead end.** The decision is recorded and nothing else happens.
6. **Notification producers are missing** for event submission, venue approve/reject, important changes, registration updates, confirmation and cancellation. In-app only, no email or SMS.
7. **Blanket RLS remains** on many tables, and any coordinator can read every non-draft event.
8. **Process and documentation gaps:** no coverage threshold (100% is a rubric target), no traceability matrix, C4 and README out of date, and no instructor-access note.

## 2. Week 4 core features

| # | Feature | Verdict | Evidence | Gap |
| --- | --- | --- | --- | --- |
| 1 | Authorisation and authentication | 🟡 | Supabase Auth sign-in/register (`services/auth-service/src/routes/auth.ts`, `apps/web/src/app/(auth)/`); roles in `packages/shared/src/roles.ts`. Per-role row rules on `events` and its history tables (Mig/14, 15, 21, 22, 49), `venue_bookings` (07, 09, 32), review tables (08), `event_registrations` (11, 29), `notifications` (35), `venue_unavailability` (39), `technical_staff_assignments` (41), `safety_checks` and `venue_booking_flags` (36, 37) | Still the blanket "any signed-in user, any row" rule from `Mig/02_rls.sql`: `organisations`, `users` (everyone can read everyone's email and phone), `event_categories`, `room_layouts`, `facilities`, `venues` and its link tables, `equipment`, `technical_support_requests`, `activity_log`. `equipment_reservations` is open for read and delete. Any coordinator can read all non-draft events (`Mig/14:147-158`), not just their own. Tracked as SCRUM-91/92/93 |
| 2 | Event request creation | ✅ | Every listed field is in `packages/shared/src/eventRequest.ts` and `Mig/49` (`create_event_request()`); `services/event-service/src/routes/eventRequests.ts`; `apps/web/src/app/events/new/page.tsx`; tests `event-request-create`, `eventRequestCreateRls`, `eventRequestSubmitDb`, web `event-request-form` | Venue and equipment requirements are free text |
| 3 | Draft event requests | ❌ | `Mig/49` writes `status = 'submitted'`, `is_draft = false` (lines 52–61), and its comment says "Draft requests will need their own policy" (line 80); the organiser insert policy allows only `submitted` | No save-draft, resume or edit route. No draft screen in `apps/web/src`. Jira marks the draft stories SCRUM-53 to 56 Done, but no draft branch, PR or code exists `/my-event-requests` lists requests but cannot edit them |
| 4 | Event review and approval | 🟡 | Start review, approve, reject: `routes/events.ts:298-341`; clarification request via `post_event_comment()` (Mig/44); outcome shown to the organiser: `GET /events/:id/outcome`, `EventReviewOutcome`; tests `review-change-request` family and notification tests | Asking for amendments does not close the loop: the `returned` status exists only via the generic dropdown, and the organiser cannot edit and resubmit (only the coordinator can edit) |
| 5 | Coordinator assignment / reassignment | ✅ | `lead_assign_coordinator` (Mig/23), `lead_reassign_coordinator` (24), `events_assignment_guard` trigger; `routes/lead.ts`; pages `lead/events/[id]/assign` and `reassign`; tests `lead-assign`, `lead-reassign` | None for this feature; see Week 7 #5 for the Lead's notifications |
| 6 | Event status management | 🟡 | All statuses exist (`Mig/01:29`, `packages/shared/src/eventStatus.ts`); history in `event_status_history`; safety gate before Confirmed (`Mig/37`) | `change_event_status()` (Mig/04) accepts any status from any status. `EventStatusPanel.tsx:116` renders every status as an option, including `draft`. Confirmed, Completed and Cancelled are reached only that way; there is no cancel route, and organisers cannot cancel. Cancelling does not release venue or equipment; only cancelling a single booking does (`cancel_venue_booking`, Mig/30) |
| 7 | Event information management | ✅ | `update_event_details()` and `event_change_history.is_important` (Mig/34); `packages/shared/src/eventDetails.ts`; impact warning `CONFIRM_IMPACT` (`eventImpact.ts`); send-back of affected arrangements (Mig/40); edit page `events/[id]/edit`; tests `event-details`, `eventDetailsDb`, `event-impact`, `sendBackDb` | Only the assigned coordinator edits; organisers use change requests (#19) |
| 8 | Venue catalogue | 🟡 | Schema: location, capacity, layouts, facilities, operating hours, accessibility (`Mig/01:178-204`), plus setup/turnaround (26) and emergency access and restrictions (37); read routes `services/venue-service/src/routes/venues.ts:95,125`; pages `venues/page.tsx`, `venues/[id]/page.tsx` | Read-only. Venue Staff cannot create or edit a venue, its layouts or its facilities (the "Edit venue" button only opens setup/turnaround). Venues exist only via seed data |
| 9 | Venue availability calendar | 🟡 | `GET /venues/:id/availability?date=` (`venues.ts:166-205`) returns bookings with padding plus unavailability blocks; page `venues/[id]/availability`; tests `venueAvailability`, web `venue-availability`, e2e `venue-padding` | One venue, one day at a time. No multi-day calendar or cross-venue view. The calendar is in open PRs #130 and #131 (SCRUM-84), not merged. `component-venue-service.puml:44` still lists it as Planned |
| 10 | Venue search and filtering | ✅ | `GET /venues/search`, `available_venues()` (latest `Mig/39`); UI `components/VenueCatalogue.tsx:153-198`. Filters: dates, times, attendance, location, layout, accessible-only, facilities (all ticked must be present); operating hours and padding enforced | Minor: location is a text "contains" match; accessibility is a yes/no flag, so free-text needs are not matched |
| 11 | Venue suitability checking | 🟡 | `packages/shared/src/venueSuitability.ts`; `GET /venue-suitability`; also run on request (Mig/33); capacity, layout, operating hours, availability judged; tests unit, integration, e2e | Facilities are never checked (`notChecked("facilities")`) because events record no required facilities, and accessibility is a manual text check. Week 4 explicitly names "a required facility is unavailable". Over-capacity is a warning (`exceedsCapacity`), not a refusal |
| 12 | Venue booking request | ✅ | `POST /venue-bookings` (`venueBookings.ts:41`); Mig/06, 07, 28; page `events/[id]/venue-request`; tests `submitBooking`, `bookingLifecycle`, web `venue-request` | None |
| 13 | Venue booking approval | ✅ | `POST /venue-bookings/:id/approve` and `/reject` (`venueBookings.ts:133,142`); queue `app/booking-queue`; rejection reason field; tests `approveBooking`, `rejectBooking`, `bookingQueue`, integration `bookingDecision` | The "suggested alternative" (SCRUM-40) is not built. It is in the Week 1 text, not in the Week 4 feature |
| 14 | Booking conflict detection | ✅ | Trigger `venue_bookings_padded_overlap` (Mig/27, extended in 39) locks the venue row and raises `23P01`; the original exclusion constraint was replaced in 27; every non-final status holds the slot; tests `slotConflictRule`, `paddedOccupancy`, `bookingConstraints` | None |
| 15 | Equipment request management | ✅ | `POST/PATCH /events/:id/equipment-requests` (`services/equipment-service/src/routes/equipmentRequests.ts`); Mig/25, 32, 45; Technical Support queue `app/equipment-requests`; tests unit and integration | Request notes (SCRUM-87/AC8) not built |
| 16 | Equipment availability checking | ✅ | `equipment_free_units()` (Mig/32) returns 0 unless the item is `available` and subtracts overlapping reserved units; `GET /equipment-availability`, `/equipment-inventory`; tests `equipmentAvailability`, `equipmentInventory` | Damage is per catalogue item, not per unit |
| 17 | Equipment reservation | ✅ | `POST /equipment-reservations` runs `reserve_equipment()` atomically (Mig/12) and stores `event_id`; page `app/equipment-reservation` | None |
| 18 | Attendee registration | 🟡 | Browse (`list_public_events()`, Mig/28), register (`routes/registrations.ts:161`), withdraw (`:69`, Mig/29), My registrations, organiser and coordinator views, registration window check | **Every registration is saved `waitlisted` (shown as Pending)** (`registrations.ts:181`), and nothing moves it to `registered`. Only Confirmed counts toward capacity (Mig/11, 28), so the capacity cap never triggers. An attendee cannot confirm themselves and no approval route exists |
| 19 | Event change requests | ✅ | Submit (`routes/changeRequests.ts:38`, Mig/15); review (`routes/changeRequestReview.ts`, `review_change_request()` Mig/42) approves through `update_event_details()` so important changes send arrangements back for review; tests unit, integration, e2e | None |
| 20 | Notification system | 🟡 | Producers (DB triggers, ADR 0002): coordinator assignment and reassignment (Mig/44, 50), approval/rejection, clarification and answer, safety decision, technician assignment (41), venue booking flagged (46). Read side: `services/notification-service`, page `/notifications`, header bell | **No producer** for event submission, venue booking approved/rejected, important event changes, registration updates, event confirmed, event cancelled. In-app only; no email or SMS |

## 3. End-to-end workflow

Week 4: "your software release should support coherent end-to-end event workflows".

| Step | Works through the UI? |
| --- | --- |
| Draft | ❌ missing |
| Submit | ✅ |
| Lead assigns a coordinator | ✅ |
| Coordinator starts review, approves | ✅ |
| Approved → Planning → Awaiting Arrangements | 🟡 only through the free status dropdown |
| Venue request and approval | ✅ (allowed while Approved, Planning or Awaiting Arrangements) |
| Equipment request and arrangement | ✅ (needs an approved venue booking) |
| Safety check | 🟡 works, but the event only reaches the queue once someone sets Awaiting Arrangements by hand |
| Confirmed | 🟡 dropdown only, safety-gated |
| Public listing and registration | 🟡 listing works; registrations stay Pending |
| Completed or Cancelled | 🟡 dropdown only; cancel releases nothing |

Browser (Playwright) tests in `apps/web/tests/e2e/` cover sign-in, the app shell, notifications, change requests and the venue features. They do not cover request creation, approval, Lead assignment, the safety check or registration.

## 4. Week 7 customer changes

| # | Change | Verdict | Evidence | Gap |
| --- | --- | --- | --- | --- |
| 1 | Venue setup and turnaround time | ✅ | Per venue (Mig/26, `PUT /venues/:id/timing`); padded period in availability, search and conflicts (`venue_padded_period`, Mig/27); the 10:00–12:00 + 30/45 → 09:30–12:45 example is tested (`services/venue-service/tests/unit/paddedOccupancy.test.ts:14`); bookings that clash after a change are flagged, not removed (`venue_booking_flags`, Mig/36; approving a flagged booking is refused, `CS104`) | None |
| 2 | Venue unavailable after booking | ✅ | `mark_venue_unavailable()` (Mig/39, 46); reasons include maintenance, renovation, safety, equipment failure (38), other; affected bookings flagged and the assigned coordinator notified in the same transaction; event and booking untouched; replacement search and request (`GET /venue-bookings/:id/replacement-candidates`, `POST …/replacement`, Mig/47, 48; page `venue-bookings/[id]/replacement`) | None |
| 3 | Multiple venues for one event | ✅ | Mig/28 drops the one-per-event rule; each booking has its own attendance, requirements and checks; change or cancel one booking without touching the others (Mig/30; `PATCH /venue-bookings/:id`, `POST …/cancel`) | None |
| 4 | Tentative venue holds expire | ❌ | Only a front-end display exists: `apps/web/src/lib/holds.ts` (its own comment: "The venue-service has no holds yet"), `VenueBookingCard.tsx`, `EventVenueBookings.tsx`; tests `holds.test.ts` | No expiry column in any migration. `holdExpiresAt` is never set by a service, so the countdown never shows real data. No job that releases an expired hold. The conflict trigger and `available_venues()` have no expiry check, so a `tentative` row holds the slot forever. No notification before or at expiry. `tentative` is read as **APPROVED** (`packages/shared/src/venueBooking.ts:18`, marked "legacy seed rows"), against "an expired hold should not be treated as a confirmed booking". `docs/specs/venue-booking-request.md:104,132` say expiry is out of scope; no spec covers this change |
| 5 | Event Coordinator Lead | ✅ | Role (Mig/16); shared unassigned queue (Mig/21, `routes/lead.ts`, `lead/queue`); basic-info view; assign and reassign to own coordinators only (Mig/23, 24); workload overview (Mig/22, 51); notifications to the new and previous coordinator (Mig/50) | The Lead sees their own team's events only. The organiser and the Lead get no notification on assignment. Coordinators can still read all non-draft events (see feature #1) |
| 6 | Operational safety check | 🟡 | Role and queue (Mig/37, 43; `routes/safetyChecks.ts`; pages `safety-checks`, `safety-checks/[id]`); queue requires Awaiting Arrangements, all venue bookings approved, all equipment arranged; shown: attendance, capacity, layout, emergency access, accessibility, equipment placement, restrictions; Approve / Reject (reason) / Request Changes (comment); `events_safety_gate` stops Confirmed without approval, service role included; an important change revokes the approval | **Reject is a dead end**: recorded, but the event stays Awaiting Arrangements and never re-enters the queue. **Request Changes** only moves the event to Planning; it does not send venue or equipment back for review. **Crowd movement** is shown as "not recorded" (`apps/web/src/lib/safetyFactors.ts:51`) |

## 5. Week 4 deliverables and rubric

| Item | Verdict | Evidence and gaps |
| --- | --- | --- |
| C4 model | 🟡 | `docs/architecture/c4/`: `context.puml`, `container.puml`, and component diagrams for event, venue, equipment and notification services. No auth-service component diagram. `context.puml` and `container.puml` show only the 5 original roles (no Lead or Safety Officer). `c4/rendered/` holds only `.gitkeep`. `docs/architecture/README.md` lists 3 diagrams |
| ADRs | 🟡 | 0001 (microservices), 0002 (notification outbox). None for RLS as authorisation, the shared database choice detail or the UI stack |
| Test traceability | 🟡 | About 288 test files; about 264 carry a story ID, 236 in the `SCRUM-xx/ACn` form. No traceability matrix document exists. Three files have no story reference: the `health.test.ts` files for auth-service and notification-service, and `venue-service/tests/unit/supabaseEventReader.test.ts` |
| Coverage (rubric: 100% unless stated why) | ❌ | v8 coverage is configured only in the root `vitest.config.mts`, with no thresholds anywhere, so CI cannot fail on coverage. Current coverage was not measured |
| CI | ✅ | `.github/workflows/ci.yml`: migration-number check, lint, typecheck, Vitest with coverage artefact, build, integration job (`supabase start`), Playwright e2e, `supabase db push` on `main`; `c4-diagrams.yml` renders the diagrams |
| README | 🟡 | Setup, env, seeded accounts, tests and CI are covered. No git repository link and no note that both instructors have access (deliverable 7). Stale: lists 5 roles, no Lead or Safety Officer seeded accounts, migration table stops near 35 of 51, says SCRUM-37 to 40 are not built |
| Scrum evidence (backlog, estimation, sprint artefacts, recordings, slide deck) | not assessable from the repo | Deliverables 1, 4 and 5 live outside the codebase |

## 6. Week 1 non-functional requirements

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| Security (role and relationship) | 🟡 | See feature #1 |
| Auditability | ✅ | `event_status_history`, `event_coordinator_history`, `coordinator_assignment_logs`, `event_change_history` (shown by `EventChangeHistory.tsx`), `activity_log` |
| Mobile-friendly | ✅ | `apps/web/src/components/shell/ShellFrame.tsx` collapses the sidebar below `md` into a slide-in menu; SCRUM-142/AC9 fits the safety queue to a phone |
| Status never by colour alone | ✅ | `apps/web/src/components/ui/status-badge.tsx` always renders icon and label |
| Consistency across changes | 🟡 | Strong for venue and equipment changes (send-back, flags); weak for cancellation (nothing released) and holds |
| Performance | no evidence | No performance tests, budgets or docs |
| Maintainability | ✅ | Shared rules in `packages/shared`; lint and typecheck in CI; per-service route and service layers; no TODO or FIXME markers in `src` |

## 7. Repo state

- On `main`, level with `origin/main`; the only untracked item is `.claude/`.
- Open PRs: #131 "Scrum 84/venue availability calendar" and #130 "Scrum 84/venue calendar UI". Both titles break the `SCRUM-84/AC… - …` convention in `CLAUDE.md`.
- About 60 remote branches, many stale.
- UI redesign epic SCRUM-119: merged are 120–123, 125–129, 131–137, 141 and 142 (plus follow-up 151). **Not found in `main`'s history:** SCRUM-124, 130, 138, 139, 140.

## 8. Week 1 items outside the 20 core features (informational)

| Item | Status |
| --- | --- |
| Comments and discussion | ✅ `event_comments`, `post_event_comment()` (Mig/08, 44) |
| User profile | ✅ SCRUM-68/69, `GET`/`PATCH /profile` |
| Event search | ✅ SCRUM-9 (attendee list, client-side) |
| Technical staff assignment | ✅ SCRUM-20, Mig/41 |
| Change history | ✅ Mig/34 |
| Equipment catalogue and maintenance status | ❌ nothing can add or edit equipment or change an item's `operational_status` |
| Attendee waiting list | 🟡 a `waitlisted` status exists but is used as Pending (see feature #18) |
| Supporting documents | not verified (`event_documents` table and a comment-attachments branch exist) |
| Programme, multi-session events, recurring events | not verified (`event_sessions` table exists) |
| Role dashboards, calendar | 🟡 calendar is in open PRs; dashboards not verified |
| Reminders, reports, export, attendance recording | not found in the audits |

## 9. Week 10: value beyond AI-generated code

This is for the slide deck and is not a pass/fail item. Evidence in the repo that the team can point to:

- **Spec-first process:** 30 specs in `docs/specs/`, each with an "Implementation decisions" section, and test names that cite the spec's scenario IDs.
- **Rules enforced in the database, not left to generated application code:** the padded-overlap trigger (Mig/27), the safety gate (Mig/37), the assignment guard (Mig/23, 24), atomic reserve and change functions.
- **Recorded decisions:** ADR 0001 and 0002, and the conventions in `CLAUDE.md` (append-only migrations, tests only assert on data they create, story and AC in every commit and test name).
- **Quality gates:** lint, typecheck, unit, integration and e2e in CI, with about 90% of test files traceable to a story.
- **Weak spots to prepare for in Q&A:** no coverage threshold, no traceability matrix, and the Week 7 #4 hold expiry, which has a display but no mechanism.

## 10. Next steps and suggested owners

Owners are **suggestions** for the team to confirm. Nothing has been assigned in Jira or GitHub. Each pick rests on three sources, checked on 2026-10-28:

- who authored the merged PRs for the related stories (125 merged PRs on `main`),
- `git shortlog` on the files each task would change, and
- who the related Jira stories are assigned to.

**Who is who.** Jira names, GitHub handles and git author names line up through the stories and PRs shown in the last column.

| Person | GitHub | Git author name(s) | Matched by |
| --- | --- | --- | --- |
| Goh Xiang Long | `cobaltdonkey` | cobaltdonkey | SCRUM-46 and 106 ↔ PRs #86, #95 |
| Zheng Long | `ZhengLonggg` | Liew Zheng Long | SCRUM-29, 98, 102 ↔ PRs #18, #71, #74 |
| Jerome Liau Jun Rong | `jeromeliaujr` | jeromeliaujr, Jerome | SCRUM-24, 41, 45 ↔ PRs #38, #45 |
| Caleb Lai Teck Yong | `danjaii` | CalebL, caleb, danjaii | SCRUM-47, 83, 99 ↔ PRs #98, #39, #89 |
| Nicholas Xie | `RayleighCN` | RayleighCN | SCRUM-49, 52, 84 ↔ PRs #113, #117, #130/#131 |

**Tasks, in order of risk to the Week 12 demo:**

| # | Task | Suggested owner | Also involved | Why this person | Jira today |
| --- | --- | --- | --- | --- | --- |
| 1 | **Tentative hold expiry** (Week 7 #4, mandatory): expiry column, make the conflict trigger and `available_venues()` ignore expired holds, a sweep that expires them, notify the coordinator before and at expiry, stop mapping `tentative` to APPROVED, write a spec | Nicholas Xie | Goh Xiang Long reviews the database part; Jerome Liau for the existing countdown UI (`apps/web/src/lib/holds.ts`, SCRUM-133) | Nicholas is the Jira assignee of both hold stories. Goh Xiang Long wrote the padded-overlap trigger and `available_venues()` that must change (migrations 27, 39) and has the most commits in `services/venue-service/src` (19) | SCRUM-97 "Tentative Venue Holds Expire" and SCRUM-108 "Warn Coordinator Before and When a Hold Expires", both To Do |
| 2 | **Draft event requests**: a draft insert policy, save/resume/delete routes, draft screen | Nicholas Xie | Jerome Liau for the drafts list UI | Nicholas is assigned the four draft stories and wrote `create_event_request()` (migration 49, PR #113) | SCRUM-53 to 56 are marked **Done** in Jira, but no draft code, branch or PR exists on `main`, so reopen them or find the missing work. SCRUM-124 (Jerome, drafts UI redesign) is To Do |
| 3 | **Registration confirmation and capacity**: decide who moves a registration to Confirmed so the cap and waiting list work | Caleb Lai | none needed | Assignee of SCRUM-71 to 74 and 83; sole author of `routes/registrations.ts` and migrations 11 and 29 (PRs #39, #70, #72, #73) | No open story; create one |
| 4 | **Guarded status transitions, and Cancel event that releases venue bookings and equipment** | Zheng Long | Jerome Liau for `EventStatusPanel` and the event routes | Zheng Long did the status stories SCRUM-6, 7, 8 and `change_event_status()` (migration 04). They also built the single-booking cancel and release (SCRUM-102, migration 30) and the send-back (SCRUM-113) that the cancel path should reuse. Jerome has most commits to `routes/events.ts` (42) and `EventStatusPanel.tsx` | No open story; create one |
| 5 | **Safety Officer follow-through**: define what Reject does, make Request Changes send arrangements back, record crowd movement | Caleb Lai | Zheng Long (the SCRUM-113 send-back mechanism); Jerome Liau (the SCRUM-142 safety page) | Assignee of SCRUM-99, 100, 116; sole author of migrations 37, 43 and `routes/safetyChecks.ts` | No open story; create one |
| 6 | **Missing notification producers** (submission, venue approve/reject, important change, registration update, confirmation, cancellation) and email/SMS | Caleb Lai (owns the pattern) | Goh Xiang Long for venue approve/reject; Zheng Long for important changes; Nicholas Xie for submission (inside `create_event_request()`) | Caleb wrote the producers in migration 44 (SCRUM-47). Goh Xiang Long wrote the read side (SCRUM-46) and the venue-flag notification (SCRUM-106) | SCRUM-144 "Mark all notifications as read" is To Do and unassigned; Jerome built the notification centre (SCRUM-141) and is the natural pick. No story for the producers |
| 7 | **Row-level security on the remaining tables**, and limit coordinators to their assigned events | Goh Xiang Long | Zheng Long for `equipment` and `equipment_reservations` | Goh Xiang Long did SCRUM-91 and the events and `venue_bookings` policies (migrations 14, 07). Zheng Long wrote the original `02_rls.sql` and has the most commits in `equipment-service` | SCRUM-92 and 93, which `CLAUDE.md` cites, **do not exist in Jira**; create them |
| 8 | **Venue create/edit, and facilities in the suitability check** | Goh Xiang Long | Nicholas Xie / Jerome Liau, because facilities need a "required facilities" field on the request form (#103, #113) | Assigned SCRUM-57 and 58; wrote `venueSuitability.ts` (SCRUM-109) and 6 of the 8 commits to `venues.ts` | SCRUM-57, 58 To Do |
| 9 | **Merge the SCRUM-84 availability calendar** and retitle the PRs to `SCRUM-84/AC… - …` | Nicholas Xie | Jerome Liau for the SCRUM-130 redesign | Author of both open PRs (#130, #131, which overlap) and assignee of SCRUM-84 and 85 | SCRUM-84, 85 (Nicholas) and SCRUM-130 (Jerome), all To Do |
| 10a | **C4 diagrams**: add the Lead and Safety Officer to the context and container diagrams | Jerome Liau | Caleb Lai for the safety officer wording | Built the Lead stories (SCRUM-75 to 81) and has 10 commits to `docs/architecture/c4` | None |
| 10b | **C4 diagrams**: add an auth-service component diagram | Caleb Lai | none needed | Owner of the auth-service stories (SCRUM-12 to 17) | None |
| 10c | **ADR** for row-level security as the authorisation model | Goh Xiang Long | none needed | Owner of the RLS work (task 7) | None |
| 10d | **README**: repository link, instructor-access note, 7 roles, Lead and Safety Officer accounts, current migration list, merge-method wording | Goh Xiang Long | Caleb Lai reviews | Restructured the README (PRs #24, #28). Caleb has the most README commits (10) but carries the most other tasks below | None |
| 10e | **Coverage threshold** (or a written reason 100% is not possible) | Caleb Lai | none needed | Authored `vitest.config.mts`; has the most CI workflow commits (12) | None |
| 10f | **Traceability matrix** mapping stories and spec scenarios to test files | Zheng Long | none needed | 16 commits to `docs/specs`; made two integration tests independent of each other (#112), so knows the test layout | None |

**Load per person** (primary owner only): Nicholas Xie 3 (tasks 1, 2, 9), Caleb Lai 5 (3, 5, 6, 10b, 10e), Goh Xiang Long 4 (7, 8, 10c, 10d, plus review on task 1), Zheng Long 2 (4, 10f), Jerome Liau 1 (10a, plus support on 1, 2, 4, 5, 9).

**Things to settle before assigning:**

- **Task 1 is the riskiest.** It is mandatory, has no spec, and sits with the contributor who has merged the fewest PRs (two) and also holds the calendar stories. Pairing Nicholas Xie with Goh Xiang Long on the database part is recommended.
- **Caleb Lai's load is the heaviest.** If it needs trimming, move task 6's venue and important-change parts to Goh Xiang Long and Zheng Long, as listed.
- **Jerome Liau has the most room.** Their natural additions are the route and UI side of task 4 and Jira SCRUM-144.
- **Jira gaps.** Tasks 3, 4, 5, 6, 7 and 10 have no open story, and SCRUM-92 and 93 are missing. These would need creating before work starts, using the `SCRUM-<story>/AC<n>` convention from `CLAUDE.md`.
- **Availability is unknown.** This is based on past work and assignments only, not on who has time in the current sprint.
