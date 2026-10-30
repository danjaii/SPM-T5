# Requirements status: ConnectSphere vs the Week 1–10 customer requirements

- **Assessed:** 2026-10-28, `main` @ `8c5ee65` (level with `origin/main`)
- **Sources** (IS212 AY2026/27 T1 project folder): Week 1 Customer Briefing, Week 4 Project Instructions, Week 7 Customer Changes (PDF), Week 10 CFO/CTO AI Check
- **Customer answers added 2026-10-28:** `G1G2_Answers_week4 v1.0 (1).xlsx` (10 answers, cited as **W4 r<n>**) and `G1G2 clarification Answers wk9.xlsx` (66 answers, cited as **W9 r<n>**). `r<n>` is the spreadsheet row, so the row can be looked up directly. Where a Week 9 answer disagrees with an older one, Week 9 is treated as current. Section 11 lists every answer that changed a verdict, and the verdicts below already reflect them.
- **Method:** static review of migrations, service routes, web pages and tests, with spot checks of the highest-impact claims. **The test suite was not run**, so "tests exist" means the files exist, not that they pass.
- **Legend:** ✅ Met · 🟡 Partial · ❌ Not met
- **Precedence:** the Week 4 list of 20 core features is the release-1 scope. The Week 7 changes are all mandatory ("all of the suggested changes should be implemented"). Week 1 items outside the 20 are optional and only listed for information (section 8).
- Paths are relative to the repo root. `Mig/NN` means `supabase/migrations/NN_*.sql`.

## 1. Scoreboard

| Source | ✅ | 🟡 | ❌ |
| --- | --- | --- | --- |
| Week 4 core features (20) | 9 | 10 | 1 |
| Week 7 changes (6) | 1 | 4 | 1 |

Before the Week 4 and Week 9 customer answers were added these were 11 / 8 / 1 and 4 / 1 / 1. Five rows moved from ✅ to 🟡: Week 4 features 5 and 19, and Week 7 changes 1, 2 and 5 (feature 5 and Week 7 change 5 are the same Lead capability, listed in both tables). Each moved because an answer describes behaviour the code does not have. Nothing moved the other way, and no ❌ row changed.

**Biggest gaps, in order of risk to the Week 12 demo:**

1. **Week 7 #4, tentative holds expire: not built.** There is only a front-end countdown that never receives data. No expiry column, no release job, no notification, and the back end treats `tentative` as APPROVED. The only spec that mentions it scopes it out. It is mandatory.
2. **No draft event requests.** A request can only be created already submitted.
3. **Registrations never become Confirmed.** Every registration is saved Pending (`waitlisted`), and only Confirmed ones count toward capacity, so the capacity cap can never trigger.
4. **Status management has no transition rules, and cancel releases nothing.** Confirmed, Completed and Cancelled are reached through a free dropdown that accepts any status. Cancelling an event does not free its venue bookings or equipment, which the Week 1 briefing calls out as a problem to fix.
5. **Safety Officer "Reject" and the automatic start: done** (SCRUM-171, Mig/66). Reject returns the event to Planning (W9 r11, r22, r64), and the last arrangement approved moves a Planning event into the queue (W9 r63).
5a. **Two built behaviours contradict the Week 9 answers.** A Confirmed event whose venue becomes unavailable must revert to Planning (W9 r44, r51), but the code leaves the event untouched. The Lead must see and assign across all coordinators (W9 r16, r37), but the code limits the Lead to their own supervised coordinators.
6. **Notifications are in-app only** (no email or SMS). The missing producers were added by SCRUM-172 (Mig/65), except a notice when a venue block is lifted, which needs a way to lift one first.
7. **Blanket RLS remains** on some reference tables. A coordinator now reads only the events assigned to them (SCRUM-156).
8. **Process and documentation gaps:** coverage below the rubric's 100% target (reasons in `docs/testing/coverage.md`, with 39 files still needing tests), no traceability matrix, C4 and README out of date, and no instructor-access note.

## 2. Week 4 core features

| # | Feature | Verdict | Evidence | Gap |
| --- | --- | --- | --- | --- |
| 1 | Authorisation and authentication | 🟡 | Supabase Auth sign-in/register (`services/auth-service/src/routes/auth.ts`, `apps/web/src/app/(auth)/`); roles in `packages/shared/src/roles.ts`. Per-role row rules on `events` and its history tables (Mig/14, 15, 21, 22, 49), `venue_bookings` (07, 09, 32), review tables (08), `event_registrations` (11, 29), `notifications` (35), `venue_unavailability` (39), `technical_staff_assignments` (41), `safety_checks` and `venue_booking_flags` (36, 37) | Still the blanket "any signed-in user, any row" rule from `Mig/02_rls.sql`: `organisations`, `users` (everyone can read everyone's email and phone), `event_categories`, `room_layouts`, `facilities`, `venues` and its link tables, `equipment`, `technical_support_requests`, `activity_log`. `equipment_reservations` is open for read and delete. Any coordinator can read all non-draft events (`Mig/14:147-158`), not just their own. SCRUM-91 chose this on purpose, but the customer later said "access control is based strictly on the user's role and direct relationship to an event" (W9 r15), that coordinators "only manage events assigned to them by the Lead" (W9 r36) and that the unassigned queue is for Leads (W9 r61), so it now counts as a gap (see [ADR 0003](docs/architecture/adr/0003-row-level-security-as-authorisation.md)). Internal accounts are pre-loaded and self-registration is out of scope (W4 r4, W9 r67), so there is no onboarding gap. Remaining work is scoped in ADR 0003 (SCRUM-153 for `equipment_reservations`; SCRUM-92 and 93 do not exist in Jira) |
| 2 | Event request creation | ✅ | Every listed field is in `packages/shared/src/eventRequest.ts` and `Mig/49` (`create_event_request()`); `services/event-service/src/routes/eventRequests.ts`; `apps/web/src/app/events/new/page.tsx`; tests `event-request-create`, `eventRequestCreateRls`, `eventRequestSubmitDb`, web `event-request-form` | Venue and equipment requirements are free text |
| 3 | Draft event requests | ❌ | `Mig/49` writes `status = 'submitted'`, `is_draft = false` (lines 52–61), and its comment says "Draft requests will need their own policy" (line 80); the organiser insert policy allows only `submitted` | No save-draft, resume or edit route. No draft screen in `apps/web/src`. Jira marks the draft stories SCRUM-53 to 56 Done, but no draft branch, PR or code exists `/my-event-requests` lists requests but cannot edit them |
| 4 | Event review and approval | 🟡 | Start review, approve, reject: `routes/events.ts:298-341`; clarification request via `post_event_comment()` (Mig/44); outcome shown to the organiser: `GET /events/:id/outcome`, `EventReviewOutcome`; tests `review-change-request` family and notification tests | Asking for amendments does not close the loop: the `returned` status exists only via the generic dropdown, and the organiser cannot edit and resubmit (only the coordinator can edit) |
| 5 | Coordinator assignment / reassignment | 🟡 | `lead_assign_coordinator` (Mig/23), `lead_reassign_coordinator` (24), `events_assignment_guard` trigger; `routes/lead.ts`; pages `lead/events/[id]/assign` and `reassign`; tests `lead-assign`, `lead-reassign` | The customer says the Lead can assign any event to any coordinator with no restriction and no workload limit (W9 r16, r17, r24), can reassign at any time even after arrangements are confirmed (W9 r21), and that the Lead sees all unassigned requests and active assignments system-wide (W9 r31, r37). The code limits the Lead to coordinators they supervise (`users.supervising_lead_id`, Mig/19, 23, 24). One answer (W9 r58, "done by him") can be read as limiting the Lead to their own assignments, so confirm with the team before changing it. Already as the customer wants: reassignment is direct and immediate with no acceptance step (W9 r35, r59), coordinators cannot claim or request reassignment (W9 r36, r60), and the Lead cannot coordinate events. See Week 7 #5 for the notifications |
| 6 | Event status management | 🟡 | All statuses exist (`Mig/01:29`, `packages/shared/src/eventStatus.ts`); history in `event_status_history`; safety gate before Confirmed (`Mig/37`) | `change_event_status()` (Mig/04) accepts any status from any status. `EventStatusPanel.tsx:116` renders every status as an option, including `draft`. Confirmed, Completed and Cancelled are reached only that way; there is no cancel route, and organisers cannot cancel. Cancelling does not release venue or equipment; only cancelling a single booking does (`cancel_venue_booking`, Mig/30). The customer wants a reason recorded and sent as a notification for every approval, rejection, major change and cancellation (W9 r19), and wants Confirmed to need every required venue and technical arrangement approved plus the safety check (W9 r26, r54, r32); the safety gate covers the last part. An event with no equipment is treated as complete (W4 r6), which the safety queue already does |
| 7 | Event information management | ✅ | `update_event_details()` and `event_change_history.is_important` (Mig/34); `packages/shared/src/eventDetails.ts`; impact warning `CONFIRM_IMPACT` (`eventImpact.ts`); send-back of affected arrangements (Mig/40); edit page `events/[id]/edit`; tests `event-details`, `eventDetailsDb`, `event-impact`, `sendBackDb` | Only the assigned coordinator edits; organisers use change requests (#19) |
| 8 | Venue catalogue | 🟡 | Schema: location, capacity, layouts, facilities, operating hours, accessibility (`Mig/01:178-204`), plus setup/turnaround (26) and emergency access and restrictions (37); read routes `services/venue-service/src/routes/venues.ts:95,125`; pages `venues/page.tsx`, `venues/[id]/page.tsx` | Read-only. Venue Staff cannot create or edit a venue, its layouts or its facilities (the "Edit venue" button only opens setup/turnaround). Venues exist only via seed data. The customer is explicit that the catalogue must allow creating and maintaining venues and equipment (W9 r12), and that layout types are defined by Venue Staff, who can add, edit and delete them (W9 r14); `room_layouts` is currently a lookup table nobody can maintain through the app |
| 9 | Venue availability calendar | 🟡 | `GET /venues/:id/availability?date=` (`venues.ts:166-205`) returns bookings with padding plus unavailability blocks; page `venues/[id]/availability`; tests `venueAvailability`, web `venue-availability`, e2e `venue-padding` | One venue, one day at a time. No multi-day calendar or cross-venue view. The calendar is in open PRs #130 and #131 (SCRUM-84), not merged. `component-venue-service.puml:44` still lists it as Planned |
| 10 | Venue search and filtering | ✅ | `GET /venues/search`, `available_venues()` (latest `Mig/39`); UI `components/VenueCatalogue.tsx:153-198`. Filters: dates, times, attendance, location, layout, accessible-only, facilities (all ticked must be present); operating hours and padding enforced | Minor: location is a text "contains" match; accessibility is a yes/no flag, so free-text needs are not matched |
| 11 | Venue suitability checking | 🟡 | `packages/shared/src/venueSuitability.ts`; `GET /venue-suitability`; also run on request (Mig/33); capacity, layout, operating hours, availability judged; tests unit, integration, e2e | Facilities are never checked (`notChecked("facilities")`) because events record no required facilities, and accessibility is a manual text check. Week 4 explicitly names "a required facility is unavailable". Over-capacity is a warning (`exceedsCapacity`), not a refusal. The customer has since said requirements are entered as free text (W9 r12) and the check is the coordinator's judgment after the request exists, with no automatic block when a venue falls short (W9 r18), so a structured facilities check is lower priority than it looked; record it as an assumption if it stays manual |
| 12 | Venue booking request | ✅ | `POST /venue-bookings` (`venueBookings.ts:41`); Mig/06, 07, 28; page `events/[id]/venue-request`; tests `submitBooking`, `bookingLifecycle`, web `venue-request` | None |
| 13 | Venue booking approval | ✅ | `POST /venue-bookings/:id/approve` and `/reject` (`venueBookings.ts:133,142`); queue `app/booking-queue`; rejection reason field; tests `approveBooking`, `rejectBooking`, `bookingQueue`, integration `bookingDecision` | The "suggested alternative" (SCRUM-40) is not built. It is in the Week 1 text, not in the Week 4 feature |
| 14 | Booking conflict detection | ✅ | Trigger `venue_bookings_padded_overlap` (Mig/27, extended in 39) locks the venue row and raises `23P01`; the original exclusion constraint was replaced in 27; every non-final status holds the slot; tests `slotConflictRule`, `paddedOccupancy`, `bookingConstraints` | None |
| 15 | Equipment request management | ✅ | `POST/PATCH /events/:id/equipment-requests` (`services/equipment-service/src/routes/equipmentRequests.ts`); Mig/25, 32, 45; Technical Support queue `app/equipment-requests`; tests unit and integration | Request notes (SCRUM-87/AC8) not built |
| 16 | Equipment availability checking | ✅ | `equipment_free_units()` (Mig/32) returns 0 unless the item is `available` and subtracts overlapping reserved units; `GET /equipment-availability`, `/equipment-inventory`; tests `equipmentAvailability`, `equipmentInventory` | Damage is per catalogue item, not per unit |
| 17 | Equipment reservation | ✅ | `POST /equipment-reservations` runs `reserve_equipment()` atomically (Mig/12) and stores `event_id`; page `app/equipment-reservation` | None |
| 18 | Attendee registration | 🟡 | Browse (`list_public_events()`, Mig/28), register (`routes/registrations.ts:161`), withdraw (`:69`, Mig/29), My registrations, organiser and coordinator views, registration window check | **Every registration is saved `waitlisted` (shown as Pending)** (`registrations.ts:181`), and nothing moves it to `registered`. Only Confirmed counts toward capacity (Mig/11, 28), so the capacity cap never triggers. An attendee cannot confirm themselves and no approval route exists. The customer has now settled who confirms: attendees register directly up to capacity, and the organiser decides what happens beyond it (W9 r29); registration is capped by overall venue/event capacity, not expected attendance, and an organiser may add VIPs manually beyond the normal cap up to venue capacity (W4 r5); one registration per account per event (W9 r28; the partial unique index in Mig/11 already does this) |
| 19 | Event change requests | 🟡 | Submit (`routes/changeRequests.ts:38`, Mig/15); review (`routes/changeRequestReview.ts`, `review_change_request()` Mig/42) approves through `update_event_details()` so important changes send arrangements back for review; tests unit, integration, e2e | Two rules from the customer are not in the code: an open change request for an event that becomes Completed or Cancelled must be closed or rejected automatically (W9 r8; today the reviewer can only reject it by hand, and no trigger closes it), and a second conflicting major request should wait until the active one is processed (W9 r4; `changeRequests.ts` does not look for a pending one). Venue changes are carried as free-text venue requirements only; the customer expects the organiser to ask for a changed or replaced venue this way and the coordinator to run the search and the suitability and conflict checks (W9 r6), which the existing replacement flow covers. Organisers cannot withdraw a submitted request themselves, only through the coordinator (W9 r7), which matches the code |
| 20 | Notification system | 🟡 | Producers (DB triggers, ADR 0002): coordinator assignment and reassignment (Mig/44, 50), approval/rejection, clarification and answer, safety decision, technician assignment (41), venue booking flagged (46); SCRUM-172 (65): event submitted, venue booking approved/rejected, important change, registration status, event confirmed, event cancelled, buffer conflict, replacement venue. Read side: `services/notification-service`, page `/notifications`, header bell | In-app only; no email or SMS. Also missing, from the customer's answers: a notice to the coordinator when a venue block is lifted (W9 r43). The recipients of the submission, venue decision, important change, registration and confirmation notices are proposed, not confirmed by the customer |

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
| Safety check | ✅ the event reaches the queue by itself once its last venue booking or equipment request is approved, and Reject returns it to Planning (SCRUM-171) |
| Confirmed | 🟡 dropdown only, safety-gated |
| Public listing and registration | 🟡 listing works; registrations stay Pending |
| Completed or Cancelled | 🟡 dropdown only; cancel releases nothing |

Browser (Playwright) tests in `apps/web/tests/e2e/` cover sign-in, the app shell, notifications, change requests and the venue features. They do not cover request creation, approval, Lead assignment, the safety check or registration.

## 4. Week 7 customer changes

| # | Change | Verdict | Evidence | Gap |
| --- | --- | --- | --- | --- |
| 1 | Venue setup and turnaround time | 🟡 | Per venue (Mig/26, `PUT /venues/:id/timing`); padded period in availability, search and conflicts (`venue_padded_period`, Mig/27); the 10:00–12:00 + 30/45 → 09:30–12:45 example is tested (`services/venue-service/tests/unit/paddedOccupancy.test.ts:14`); bookings that clash after a change are flagged, not removed (`venue_booking_flags`, Mig/36; approving a flagged booking is refused, `CS104`) | The customer says Venue Staff see the conflicts when they set the buffer, the calendar flags the overlapping periods, and the affected coordinators receive notifications (W9 r47). The flags and the Venue Staff list exist; no notification is written for a buffer conflict (`Mig/36` has no notification producer), and the calendar is in the unmerged PRs #130 and #131. The customer also confirmed that buffers pad events and holds, not maintenance blocks (W9 r39, r49), and that the coordinator has the final say on a flagged booking (W9 r40) |
| 2 | Venue unavailable after booking | 🟡 | `mark_venue_unavailable()` (Mig/39, 46); reasons include maintenance, renovation, safety, equipment failure (38), other; affected bookings flagged and the assigned coordinator notified in the same transaction; event and booking untouched; replacement search and request (`GET /venue-bookings/:id/replacement-candidates`, `POST …/replacement`, Mig/47, 48; page `venue-bookings/[id]/replacement`) | **A Confirmed event is left untouched, but the customer says it must revert to Planning review, preserved and not cancelled (W9 r44, r51).** This contradicts the design choice behind SCRUM-106 ("the booking and its event are untouched"); an older Week 4 answer (W4 r8) said the status simply stays visible, and Week 9 is later. Registration may be paused or adjusted by the coordinator during re-planning (W9 r44). **End time:** the schema requires an end (`venue_unavailability.end_datetime not null`), and the customer answered both ways: not open-ended (W9 r42), and optional, open until lifted (W9 r50); ask the customer. **Lifting a block:** no way to lift one was found in migrations 38, 39 or 46. The customer says that when a venue reopens, a still-active booking has its conflict cleared and the coordinator is told (W9 r43, r53). **Notices:** the organiser and attendees are told only when replacement arrangements are confirmed (W9 r52) |
| 3 | Multiple venues for one event | ✅ | Mig/28 drops the one-per-event rule; each booking has its own attendance, requirements and checks; change or cancel one booking without touching the others (Mig/30; `PATCH /venue-bookings/:id`, `POST …/cancel`) | None. Matches the customer: each venue is checked and approved independently, a rejected venue is fixed and resubmitted alone, and every required venue must be approved before Confirmed (W9 r25, r26, r54); equipment follows the session and venue it is for (W9 r38); the organiser states general space needs and the coordinator picks the venues (W9 r46); capacity is judged per venue (W9 r9) |
| 4 | Tentative venue holds expire | ❌ | Only a front-end display exists: `apps/web/src/lib/holds.ts` (its own comment: "The venue-service has no holds yet"), `VenueBookingCard.tsx`, `EventVenueBookings.tsx`; tests `holds.test.ts` | No expiry column in any migration. `holdExpiresAt` is never set by a service, so the countdown never shows real data. No job that releases an expired hold. The conflict trigger and `available_venues()` have no expiry check, so a `tentative` row holds the slot forever. No notification before or at expiry. `tentative` is read as **APPROVED** (`packages/shared/src/venueBooking.ts:18`, marked "legacy seed rows"), against "an expired hold should not be treated as a confirmed booking". `docs/specs/venue-booking-request.md:104,132` say expiry is out of scope; no spec covers this change. **The customer's answers now supply the rules for that spec:** Venue Staff set the expiry date and time per hold, with no default length (W9 r10, r30, r45, r55), and can update or extend it without a limit, telling the coordinator (W9 r41, r57); the coordinator sets the warning time per hold, and is notified before or when the hold expires (W9 r10, r56); when a hold expires the venue is free for other requests, an expired hold is never treated as confirmed, and the coordinator submits a new request if needed (W9 r27); only one active hold or confirmed booking may exist for a venue and time slot (W4 r7); holds carry the setup and turnaround padding (W9 r39); a venue block stops new holds and bookings (W9 r42). W4 r7 said auto-expiry was "not required", but Week 7 made it mandatory and Week 9 describes it in detail, so it stays mandatory |
| 5 | Event Coordinator Lead | 🟡 | Role (Mig/16); shared unassigned queue (Mig/21, `routes/lead.ts`, `lead/queue`); basic-info view; assign and reassign to own coordinators only (Mig/23, 24); workload overview (Mig/22, 51); notifications to the new and previous coordinator (Mig/50) | **Scope:** the Lead sees their own team's events and coordinators only, but the customer says there can be several Leads and each sees every unassigned request and every active assignment system-wide (W9 r31, r37, r61); see feature 5. **Notifications:** assignment and reassignment must notify the relevant users (W9 r59); the organiser and the Lead get no notification on assignment. Coordinators can still read all non-draft events (see feature #1) |
| 6 | Operational safety check | ✅ | Role and queue (Mig/37, 43, 66; `routes/safetyChecks.ts`; pages `safety-checks`, `safety-checks/[id]`); queue requires Awaiting Arrangements, all venue bookings approved, all equipment arranged; shown: attendance, capacity, layout, emergency access, accessibility, equipment placement, restrictions; Approve / Reject (reason) / Request Changes (comment); `events_safety_gate` stops Confirmed without approval, service role included; an important change revokes the approval | **Reject** returns the event to Planning like Request Changes, and neither ends it (W9 r11, r22, r64; SCRUM-171, Mig/66). **Start:** the last arrangement approved moves a Planning event to Awaiting Arrangements with no manual step (W9 r63; SCRUM-171). An event still in Approved does not move by itself. **Request Changes** moving the event to Planning is what the customer asked for; the coordinator decides what to send back (W9 r22), so sending arrangements back automatically is not required. **Crowd movement** shown as "not recorded" (`apps/web/src/lib/safetyFactors.ts:51`) is acceptable: the Safety Officer judges the factors outside the system and records a decision with comments, and the record format is up to the team (W9 r34, r65). Confirmed as built: every event needs the check (W9 r33), and an event with no equipment passes it (W4 r6); an important change after approval needs another check (W9 r23); events already confirmed before launch are out of scope (W9 r66) |

## 5. Week 4 deliverables and rubric

| Item | Verdict | Evidence and gaps |
| --- | --- | --- |
| C4 model | 🟡 | `docs/architecture/c4/`: `context.puml`, `container.puml`, and component diagrams for all five services (auth-service added by SCRUM-166). `context.puml` and `container.puml` show only the 5 original roles (no Lead or Safety Officer). `c4/rendered/` holds only `.gitkeep`. `docs/architecture/README.md` lists all 7 diagrams |
| ADRs | 🟡 | 0001 (microservices), 0002 (notification outbox). None for RLS as authorisation, the shared database choice detail or the UI stack |
| Test traceability | 🟡 | About 288 test files; about 264 carry a story ID, 236 in the `SCRUM-xx/ACn` form. No traceability matrix document exists. Three files have no story reference: the `health.test.ts` files for auth-service and notification-service, and `venue-service/tests/unit/supabaseEventReader.test.ts` |
| Coverage (rubric: 100% unless stated why) | 🟡 | Unit test coverage measured at 93.66% statements, 89.50% branches, 91.54% functions and 94.52% lines (30 October 2026). `docs/testing/coverage.md` gives a reason for each of the 218 files below 100%, but for 39 of them the reason is a missing test. No thresholds on purpose (SCRUM-173), so CI does not fail on coverage |
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
| Performance | no evidence | No performance tests, budgets or docs. The customer gave no user count, only growth over three years and about 500 internal staff, and invites the team to propose an architecture for the scale (W4 r11), so the team should write down its own assumption |
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
| Equipment catalogue and maintenance status | ❌ nothing can add or edit equipment or change an item's `operational_status`. The customer says the catalogue must allow creating and maintaining equipment (W9 r12) |
| Attendee waiting list | 🟡 a `waitlisted` status exists but is used as Pending (see feature #18). The customer's rule is direct registration up to capacity and an organiser decision beyond it (W9 r29) |
| Supporting documents | not verified (`event_documents` table and a comment-attachments branch exist) |
| Programme, multi-session events, recurring events | Multi-session is settled: each session is set up as its own event and the organiser creates several (W4 r9), so `event_sessions` is not needed for Release 1. Programme and recurring not verified |
| Reuse a past event | ❌ not built, and it depends on drafts: organisers copy their own completed or past requests into a new draft (W9 r5) |
| Off-site client premises | Out of scope: recorded as a comment on the event and handled outside the system (W4 r10) |
| Event request limits | No code needed: a signed business contract outside the system is the only precondition (W9 r2), and no advance-notice or how-far-ahead limit is defined, so the team may state its own assumption (W9 r3) |
| Role dashboards, calendar | 🟡 calendar is in open PRs; dashboards not verified |
| Reminders, reports, export, attendance recording | not found in the audits |

## 9. Week 10: value beyond AI-generated code

This is for the slide deck and is not a pass/fail item. Evidence in the repo that the team can point to:

- **Spec-first process:** 30 specs in `docs/specs/`, each with an "Implementation decisions" section, and test names that cite the spec's scenario IDs.
- **Rules enforced in the database, not left to generated application code:** the padded-overlap trigger (Mig/27), the safety gate (Mig/37), the assignment guard (Mig/23, 24), atomic reserve and change functions.
- **Recorded decisions:** ADR 0001 and 0002, and the conventions in `CLAUDE.md` (append-only migrations, tests only assert on data they create, story and AC in every commit and test name).
- **Quality gates:** lint, typecheck, unit, integration and e2e in CI, with about 90% of test files traceable to a story.
- **Weak spots to prepare for in Q&A:** coverage below 100% with 39 files still needing tests, no traceability matrix, and the Week 7 #4 hold expiry, which has a display but no mechanism.

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
| 2 | **Draft event requests**: a draft insert policy, save/resume/delete routes, draft screen, and copying an organiser's own completed or past request into a new draft (W9 r5) | Nicholas Xie | Jerome Liau for the drafts list UI | Nicholas is assigned the four draft stories and wrote `create_event_request()` (migration 49, PR #113) | SCRUM-53 to 56 are marked **Done** in Jira, but no draft code, branch or PR exists on `main`, so reopen them or find the missing work. SCRUM-124 (Jerome, drafts UI redesign) is To Do |
| 3 | **Registration confirmation and capacity**, now decided by the customer: a registration is Confirmed straight away while slots remain, beyond capacity the organiser decides, and the organiser can add VIPs past the normal cap up to venue capacity (W9 r29, W4 r5) | Caleb Lai | none needed | Assignee of SCRUM-71 to 74 and 83; sole author of `routes/registrations.ts` and migrations 11 and 29 (PRs #39, #70, #72, #73) | No open story; create one |
| 4 | **Cancel event that releases venue bookings and equipment**, with a required reason sent as a notification (W9 r19) and any open change request closed automatically when the event is cancelled or completed (W9 r8). *Decided 2026-10-30: built as SCRUM-174 ([cancel-event.md](docs/specs/cancel-event.md)). Guarded status transitions are dropped: the customer said in the Week 2 Q&A that status progression is "generally flexible for now", and the one rule they set, safety approval before Confirmed, already exists (see [scope-decisions.md](docs/scope-decisions.md)).* | Zheng Long | Jerome Liau for `EventStatusPanel` and the event routes | Zheng Long did the status stories SCRUM-6, 7, 8 and `change_event_status()` (migration 04). They also built the single-booking cancel and release (SCRUM-102, migration 30) and the send-back (SCRUM-113) that the cancel path should reuse. Jerome has most commits to `routes/events.ts` (42) and `EventStatusPanel.tsx` | SCRUM-174 |
| 5 | **Safety Officer follow-through**: Reject returns the event to Planning like Request Changes (W9 r11, r22, r64), and the review starts automatically when arrangements are confirmed (W9 r63). The customer says Request Changes need not send arrangements back and crowd movement can stay outside the system (W9 r22, r65), so those two are dropped | Caleb Lai | Zheng Long (the SCRUM-113 send-back mechanism); Jerome Liau (the SCRUM-142 safety page) | Assignee of SCRUM-99, 100, 116; sole author of migrations 37, 43 and `routes/safetyChecks.ts` | SCRUM-171 |
| 6 | **Missing notification producers** (venue block lifted; the others were added by SCRUM-172, Mig/65) and email/SMS | Caleb Lai (owns the pattern) | Goh Xiang Long for venue approve/reject; Zheng Long for important changes; Nicholas Xie for submission (inside `create_event_request()`) | Caleb wrote the producers in migration 44 (SCRUM-47). Goh Xiang Long wrote the read side (SCRUM-46) and the venue-flag notification (SCRUM-106) | SCRUM-144 "Mark all notifications as read" is To Do and unassigned; Jerome built the notification centre (SCRUM-141) and is the natural pick. No story for the producers |
| 7 | **Row-level security on the remaining tables**, and limit coordinators to their assigned events (the customer's "role and direct relationship to an event", W9 r15, now supports this) | Goh Xiang Long | Zheng Long for `equipment` and `equipment_reservations` | Goh Xiang Long did SCRUM-91 and the events and `venue_bookings` policies (migrations 14, 07). Zheng Long wrote the original `02_rls.sql` and has the most commits in `equipment-service` | SCRUM-92 and 93, which `CLAUDE.md` cited, **do not exist in Jira**. Scoped on 2026-10-28 in [ADR 0003](docs/architecture/adr/0003-row-level-security-as-authorisation.md): `users` own row (**SCRUM-154**), catalogue writes by owning role, where Venue Staff also maintain layout types (W9 r14) (**SCRUM-155**), equipment reservations (**SCRUM-153**), then coordinator reads limited to assigned events (W9 r15) (**SCRUM-156**). All four were created on 2026-10-28, unassigned, in the backlog |
| 8 | **Venue create/edit, layout types that Venue Staff add, edit and delete (W9 r14), and equipment catalogue maintenance (W9 r12)**. A structured facilities check is now lower priority (W9 r12, r18) | Goh Xiang Long | Nicholas Xie / Jerome Liau, because facilities need a "required facilities" field on the request form (#103, #113) | Assigned SCRUM-57 and 58; wrote `venueSuitability.ts` (SCRUM-109) and 6 of the 8 commits to `venues.ts` | SCRUM-57, 58 To Do |
| 9 | **Merge the SCRUM-84 availability calendar** and retitle the PRs to `SCRUM-84/AC… - …` | Nicholas Xie | Jerome Liau for the SCRUM-130 redesign | Author of both open PRs (#130, #131, which overlap) and assignee of SCRUM-84 and 85 | SCRUM-84, 85 (Nicholas) and SCRUM-130 (Jerome), all To Do |
| 10a | **C4 diagrams**: add the Lead and Safety Officer to the context and container diagrams | Jerome Liau | Caleb Lai for the safety officer wording | Built the Lead stories (SCRUM-75 to 81) and has 10 commits to `docs/architecture/c4` | None |
| 10b | ✅ **C4 diagrams**: add an auth-service component diagram (`component-auth-service.puml`) | Caleb Lai | none needed | Owner of the auth-service stories (SCRUM-12 to 17) | SCRUM-166 |
| 10c | **ADR** for row-level security as the authorisation model | Goh Xiang Long | none needed | Owner of the RLS work (task 7) | None |
| 10d | **README**: repository link, instructor-access note, 7 roles, Lead and Safety Officer accounts, current migration list, merge-method wording | Goh Xiang Long | Caleb Lai reviews | Restructured the README (PRs #24, #28). Caleb has the most README commits (10) but carries the most other tasks below | None |
| 10e | **Coverage threshold** (or a written reason 100% is not possible) | Caleb Lai | none needed | Authored `vitest.config.mts`; has the most CI workflow commits (12) | None |
| 10f | **Traceability matrix** mapping stories and spec scenarios to test files | Zheng Long | none needed | 16 commits to `docs/specs`; made two integration tests independent of each other (#112), so knows the test layout | None |
| 11 | **Lead scope**: the Lead sees and assigns across all coordinators, system-wide, and several Leads may exist (W9 r16, r31, r37). Confirm the reading of W9 r58 first | Jerome Liau | Goh Xiang Long for the RLS side | Built the Lead stories (SCRUM-75 to 81) | No open story; create one. Added by the customer answers |
| 12 | **Venue unavailability follow-through**: a Confirmed event reverts to Planning when its venue is blocked (W9 r44, r51); a way to lift a block, clearing the conflict on a still-active booking and telling the coordinator (W9 r43, r53); organiser and attendee notice once replacement arrangements are confirmed (W9 r52); ask the customer whether a block needs an end time (W9 r42 against r50) | Goh Xiang Long | Caleb Lai for the notification part | Wrote `mark_venue_unavailable()` and the flags (SCRUM-105, 106; migrations 39, 46) that this changes | No open story; create one. Added by the customer answers. It reverses a decision recorded in SCRUM-106, so check with the team first |
| 13 | **Change request rules**: close an open change request automatically when its event is Completed or Cancelled (W9 r8), and hold a second conflicting major request while one is active (W9 r4) | not assessed | none | The original change-request authors were not looked up for this update | No open story; create one. Added by the customer answers |

**Load per person** (primary owner only): Nicholas Xie 3 (tasks 1, 2, 9), Caleb Lai 5 (3, 5, 6, 10b, 10e), Goh Xiang Long 5 (7, 8, 10c, 10d, 12, plus review on task 1), Zheng Long 2 (4, 10f), Jerome Liau 2 (10a, 11, plus support on 1, 2, 4, 5, 9). Task 13 has no owner yet. Tasks 11 to 13 were added after the customer answers.

**Things to settle before assigning:**

- **Task 1 is the riskiest.** It is mandatory, has no spec, and sits with the contributor who has merged the fewest PRs (two) and also holds the calendar stories. Pairing Nicholas Xie with Goh Xiang Long on the database part is recommended.
- **Caleb Lai's load is the heaviest.** If it needs trimming, move task 6's venue and important-change parts to Goh Xiang Long and Zheng Long, as listed.
- **Jerome Liau has the most room.** Their natural additions are the route and UI side of task 4 and Jira SCRUM-144.
- **Jira gaps.** Tasks 3, 4, 5, 6, 7 and 10 have no open story, and SCRUM-92 and 93 are missing. These would need creating before work starts, using the `SCRUM-<story>/AC<n>` convention from `CLAUDE.md`.
- **Availability is unknown.** This is based on past work and assignments only, not on who has time in the current sprint.
- **Questions for the customer or the team** (from the answers, see section 11): does a venue block need an end time (W9 r42 against r50)? Is the Lead limited to their own assignments or system-wide (W9 r58 against r37)? Should a Confirmed event revert to Planning when its venue is blocked, given that SCRUM-106 deliberately did not?

## 11. Customer clarifications (Week 4 and Week 9 answers)

Ingested 2026-10-28 from the two workbooks listed at the top. `r<n>` is the spreadsheet row. This section groups only the answers that matter to the verdicts; the rest repeat what the briefs already say or are pure process.

**Answers that exposed a gap or changed a verdict**

| Topic | Answer | Effect |
| --- | --- | --- |
| Venue blocked under a Confirmed event | W9 r44, r51: revert to Planning review, event kept, coordinator notified | Week 7 #2 moved to 🟡; the code leaves the event untouched |
| Lead scope | W9 r16, r17, r31, r37, r61: any coordinator, system-wide, several Leads | Feature 5 and Week 7 #5 moved to 🟡; code limits the Lead to supervised coordinators |
| Coordinator access | W9 r15, r36, r61: role and direct relationship to an event; coordinators manage only what the Lead gives them | Coordinators reading all non-draft events is now a gap (feature 1, task 7) |
| Safety Reject | W9 r11, r22, r64: returns to Planning, nothing is terminated | Week 7 #6: Reject is a real gap |
| Safety check start | W9 r63: automatic once arrangements are confirmed | Week 7 #6 and the workflow table |
| Change requests | W9 r4, r8: close on Completed or Cancelled; hold a second conflicting request | Feature 19 moved to 🟡 |
| Buffer conflicts | W9 r47: coordinators are notified, the calendar flags overlaps | Week 7 #1 moved to 🟡 |
| Cancellation | W9 r19: a reason is recorded and notified | Features 6 and 20 |
| Tentative holds | W9 r10, r27, r30, r41, r45, r55 to r57; W4 r7 | Supplies the rules for the missing spec (Week 7 #4, task 1) |
| Registration | W9 r28, r29; W4 r5 | Settles the open question in task 3 |
| Catalogue maintenance | W9 r12, r14 | Strengthens feature 8; layouts and equipment must be maintainable |
| Reuse a past event | W9 r5 | New item under drafts (task 2) |

**Answers that lower or remove a gap**

- Crowd movement and safety record format are flexible and may be judged outside the system (W9 r34, r65).
- Request Changes need not send arrangements back automatically (W9 r22).
- A structured facilities check is not required; requirements are free text and the coordinator judges the venue (W9 r12, r18).
- "None required" equipment counts as complete (W4 r6): the safety queue already passes such events.
- Multi-session events are separate events (W4 r9); off-site premises go in comments (W4 r10); internal accounts are pre-loaded (W4 r4, W9 r67); organisation hierarchies are out of scope (W9 r15); no advance-notice or how-far-ahead limit exists (W9 r2, r3).

**Answers that conflict with each other or with a built decision**

- Open-ended venue blocks: not allowed (W9 r42) against allowed (W9 r50). The schema requires an end date.
- Status of a Confirmed event after a venue block: stays visible (W4 r8) against reverts to Planning (W9 r44, r51). Week 9 is later.
- Hold expiry: auto-expiry "not required" (W4 r7) against mandatory with detailed rules (Week 7, W9). Treated as mandatory.
- Lead reach: "done by him" (W9 r58) against system-wide (W9 r37). Not resolved.
- Reassignment: the original coordinator makes the change and the new one accepts (W4 r3) against direct by the Lead with no acceptance (W9 r35, r59). Week 9 and the Week 7 role are later, and the code matches them.
- Auto-assignment by the system (W4 r2) was replaced by manual assignment from the Lead's queue (W9 r24, r36).
