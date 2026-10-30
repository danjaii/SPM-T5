# CLAUDE.md

Guidance for AI coding agents (Claude Code, OpenAI Codex, and others) working in this repository.
`AGENTS.md` is a symlink to this file, so both agents read the same instructions — edit here.

## Project

ConnectSphere — an event management platform. Next.js/React frontend, five Node/TypeScript
microservices (auth, event, venue, equipment, notification), one shared Supabase Postgres. pnpm
workspaces monorepo (`apps/*`, `services/*`, `packages/*`).

Read before making structural changes:
- Repo layout and rationale: [README.md](README.md)
- Why microservices + shared DB: [ADR 0001](docs/architecture/adr/0001-microservice-architecture.md)
- Feature specs (user stories, acceptance criteria, shared rules): [docs/specs/](docs/specs/). Test
  names reference the spec's scenario IDs (e.g. `36-S4`); where a spec disagrees with the schema,
  its "Implementation decisions" section wins.

## Course context

This is the release-1 build for IS212 (SMU, AY2026/27 T1), run as a Scrum project (sprints,
backlogs, estimation, standups, retrospectives) worth 35% of the course grade. That means PRs
should stay traceable back to a user story, and test coverage is graded, not optional — see
Conventions below.

### Roles

Every role below is a value of the `Role` type in `packages/shared/src/roles.ts` — add a role
there, not as a string literal in a service.

| Role | Access | Primary responsibilities |
| ----- | ----- | ----- |
| `event_organiser` | External | Creates/edits event requests (drafts & submitted), tracks approval status, requests post-submission changes, registers attendees. |
| `event_coordinator` | Internal | Manages the events assigned to them: reviews/approves event requests, requests clarifications, searches venues, submits venue booking requests. |
| `event_coordinator_lead` | Internal | Added by the week 7 customer changes. Oversees incoming event requests (the unassigned queue), assigns and reassigns Event Coordinators, views all coordinator assignments and active events. |
| `venue_staff` | Internal | Maintains the venue catalogue, approves/rejects venue bookings, sets layout options, flags unavailability (maintenance/renovation). |
| `technical_support_staff` | Internal | Maintains the equipment catalogue, checks availability, approves/reserves equipment, handles maintenance statuses. |
| `safety_officer` | Internal | Added by the week 7 customer changes. Runs the Operational Safety Check after venue and technical arrangements are confirmed: approves, rejects or requests changes before the event can proceed to preparation. |
| `attendee` | External | Browses confirmed public events, registers/withdraws within capacity limits and registration windows. |

### Feature scope (release 1)

The 20 features below define the release-1 backlog. They span the five services in Architecture
below plus `apps/web`; none of them are implemented yet (see Current state).

1. Authorisation/authentication — RBAC via Supabase Auth JWTs (see Architecture: this is
   RLS-enforced, not middleware-enforced).
2. Event request creation (dates, attendance, venue/equipment requirements).
3. Draft event requests — save/resume before final submission.
4. Event review and approval — coordinator amend/approve/reject workflow.
5. Coordinator assignment/reassignment per event (owned by `event-service`, alongside review/approval).
6. Event status state machine: `Draft → Submitted → Under Review → Approved → Planning →
   Confirmed → Completed`, with `Cancelled`/`Rejected` off-ramps.
7. Event information management — minor edits vs. critical updates (date/time/attendance) that
   must re-trigger venue/equipment validation.
8. Venue catalogue (location, capacity, layouts, operating hours, accessibility).
9. Venue availability calendar — bookings, tentative holds, maintenance blocks.
10. Venue search/filtering by date, time, capacity, layout, location, facilities.
11. Venue suitability checks — attendance ≤ capacity, required facilities present.
12. Venue booking requests from coordinators to venue staff.
13. Venue booking approval/rejection with reasons.
14. Booking conflict detection — no overlapping venue double-bookings.
15. Equipment request management (types, quantities, technical support needs).
16. Equipment availability checks against overlapping reservations.
17. Equipment reservation for an event slot.
18. Attendee registration — capacity caps, registration windows, withdrawal.
19. Event change requests post-approval — cross-service venue/equipment re-validation.
20. Notifications — in-app/email on status changes, clarifications, approvals, rejections.

Equipment/technical-support (#15-17) is owned by `equipment-service` (renamed from
`coordinator-service`, which no longer exists — coordinator assignment moved to `event-service`,
see #5). Attendee registration (#18) is owned by `event-service` (SCRUM-83: register, My
registrations, and an event's registrations for its organiser and coordinator) and SCRUM-73
(withdraw from My registrations: `POST /events/my-registrations/:id/withdraw`, with migration 29's
update policy letting an attendee change only their own active registration, and only to withdrawn).
`receivesEventUpdates()` in `packages/shared` is the rule that a withdrawn attendee gets no more
updates or reminders; migration 65's `event_update_attendees()` is its database copy (SCRUM-172).

## Commands

Run `pnpm install` once from the repo root — it installs every workspace. Don't add per-workspace
lockfiles; there is a single `pnpm-lock.yaml` at the root. Local packages are linked with the
`workspace:*` protocol.

```bash
pnpm --filter @spm-t5/web run dev             # Next.js dev server
pnpm --filter @spm-t5/auth-service run dev   # tsx watch on one service

pnpm vitest run                              # every workspace's tests + coverage report (./coverage) from the root; what CI runs
pnpm run test:all                            # every workspace, one at a time
pnpm --filter @spm-t5/web run test            # one workspace
pnpm --filter @spm-t5/auth-service run test:unit   # unit only (vitest run tests/unit)
pnpm --filter @spm-t5/auth-service run test:integration
pnpm --filter @spm-t5/auth-service run test:unit tests/unit/health.test.ts   # single file
pnpm --filter @spm-t5/auth-service run test:unit -t "reports ok status"      # single test by name

pnpm --filter @spm-t5/auth-service run typecheck   # tsc --noEmit (apps/web runs `next typegen` first)
pnpm run lint:all                            # apps/web uses ESLint flat config (eslint.config.mjs)
pnpm --filter @spm-t5/web run test:e2e        # Playwright
```

Local full stack: create a root `.env` (variables listed in README → Getting started), then `supabase start` (the Supabase CLI stack runs
separately — `docker-compose.yml` deliberately does not duplicate it) and `docker compose up -d`.

## Architecture

**Supabase Auth owns all credentials.** `users.id` is a foreign key to `auth.users(id)`
(`supabase/migrations/01_schema.sql`). Password hashing, email confirmation, session tokens and
JWT issuance are GoTrue's job. Never add `bcrypt`, `jsonwebtoken`, or a hand-rolled session
table — `auth-service` wraps Supabase Auth, it does not reimplement it.

**Authorization is Row-Level Security, not application code.** ADR 0001 chose one Postgres
instance for all five services with RLS enforcing per-role access. A service that queries with
the service-role key bypasses RLS entirely, so reach for the anon/user-scoped client by default
and use the service-role key only where bypassing is the actual intent. Express middleware may
still decode the Supabase JWT to identify the caller (`req.user`) — that's authentication, not
authorization — but it should not re-implement role checks that RLS already enforces.

**Notification service is event-driven, not polled.** Per the container diagram, `event-service`
publishes status-change events and `notification-service` reacts to them and dispatches
email/SMS — favor Supabase Realtime/webhooks or an explicit event call over having services poll
each other for state changes.

**Every service is a workspace with its own `package.json`, `tests/`, and `Dockerfile`.** Docker
builds use the repo root as context (the lockfile and `packages/shared` live there), and each
service's `build` script bundles `packages/shared` in with esbuild. CI is a single workflow,
`.github/workflows/ci.yml` (job `test`, then `e2e`), on push to `main` and PRs into it, with no path
filters. The root `vitest.config.mts` lists the workspaces as Vitest projects, so `pnpm vitest run`
discovers every workspace's tests and a new service needs no CI change.

**`packages/shared` exists to stop frontend and services drifting.** Role types, Supabase client
wrapper, and validation schemas belong there, so `apps/web` and a service validate identically
rather than duplicating a zod schema on each side. It's consumed as TypeScript source
(`"main": "src/index.ts"`), not built.

**`apps/web` calls services directly over HTTP** — no API gateway, no BFF. See
`docs/architecture/c4/container.puml` for which service owns what. Browser-visible config must be
prefixed `NEXT_PUBLIC_`; service ports are mapped in `docker-compose.yml` (auth 4001, event 4002,
venue 4003, equipment 4004, notification 4005).

## Conventions

- **Migrations are append-only.** `supabase/migrations/` is the schema source of truth. Add a new
  numbered file; never edit one that's already been applied. Schema changes can affect multiple
  services — flag them in the PR. The CI `migrate` job applies them to the hosted Supabase project on
  merge to `main`; never apply migration SQL by hand (dashboard SQL editor, `psql`), since that skips the
  migration history and the next `db push` then re-runs or skips files.
- **Tests live in `tests/unit` and `tests/integration` per workspace**, not colocated with source.
  The CI template runs the two separately, and only `test:unit` gets `--coverage`.
- **Integration tests only assert on data they create.** Vitest runs test files at the same time, all against one
  shared database, so another file may be adding, changing or deleting rows while yours runs. An exact count or list must
  come from rows and accounts the test made itself (its own Lead, its own venue bookings), never from seeded data or
  from a read of a whole table; checks on seeded data should say what is included or left out, not "exactly these". Two
  tests that broke this rule failed at random in CI (SCRUM-143).
- **Export the Express app separately from `listen()`** so integration tests can mount it without
  binding a port.
- **`src/app/` in `apps/web` is routes only** — every folder is a URL segment. Components go in
  `src/components/`, browser helpers in `src/lib/`.
- **Architecture changes need a diagram or ADR update.** Flag it in the PR;
  `docs/architecture/c4/rendered/` is CI-generated, so edit the `.puml` source only.
  `docs/architecture/c4/` currently covers C1 (`context.puml`), C2 (`container.puml`), and a C3
  `component-<service>.puml` for each of the five services — keep each one current as its service
  grows, rather than adding a C4 code diagram.
- **Keep tests traceable to a user story.** This is a graded Scrum project — reference the story
  or backlog item a test covers (commit message or test description), and aim for full coverage
  on unit tests (only `test:unit` gets `--coverage`, per Commands above).
- **A stubbed service gains internal structure as it's built out**, not before: once a
  `services/*/src/index.ts` grows past the `healthCheck()` stub, split it into `routes/`,
  `controllers/` (or `services/` for business logic), and `middlewares/` rather than one growing
  file — but keep the `tests/unit` + `tests/integration` split from the bullet above regardless.

## Git conventions

Apply these automatically whenever you create a branch, write a commit, or draft/open a PR. Don't
wait to be reminded. They exist so every change on `main` traces back to a Jira story and
acceptance criterion — part of what the Scrum project is graded on.

### Ticket references
- Jira project key is `SCRUM`. Write references exactly as `SCRUM-<story>/AC<n>` (e.g.
  `SCRUM-14/AC2`) — uppercase, hyphen, no spaces. Jira's GitHub integration only links that form;
  `SCRUM - 8` or `Scrum 6` (seen in older history) don't link.
- Jira story numbers are **not** the feature numbers 1–20 in Feature scope above. Never derive a
  ticket from that list.
- Take the story from the current branch name and the AC from the change itself or from context
  I've given you. If you can't determine either, ask. Never guess or invent a ticket or AC.
- Several ACs of one story: `SCRUM-14/AC2,AC3`. A change spanning stories should usually be split;
  if it genuinely can't be, list each: `SCRUM-6/AC1, SCRUM-7/AC2`.
- Non-story work (CI, tooling, docs, dependency bumps, refactors with no behaviour change) uses a
  type prefix instead: `chore`, `ci`, `docs`, `refactor`, `test`. If the work changes user-visible
  behaviour, it's story work — ask for the ticket.

### Branches
- Story work: `SCRUM-<story>/<short-kebab-description>`, e.g. `SCRUM-14/venue-search-filters`.
- Non-story work: `<type>/<short-kebab-description>`, e.g. `ci/cache-pnpm-store`.
- Always branch off an up-to-date `main` (`git fetch && git switch -c <branch> origin/main`) unless
  I say otherwise. One story per branch; keep branches short-lived and delete after merge — no
  long-lived per-feature branches like `user-auth`.
- Never commit or push directly to `main`, and never force-push a branch someone else has pushed to.

### Commit messages
- Title: `SCRUM-<story>/AC<n> - <Imperative summary>` or `<type> - <Imperative summary>`.
  - Imperative mood ("Add", "Fix", "Refactor", "Remove"), ≤ ~72 characters, no trailing period.
  - e.g. `SCRUM-14/AC2 - Add capacity filter to venue search endpoint`
  - e.g. `ci - Cache pnpm store between workflow runs`
- Body (optional, after a blank line): short bullets on what changed and why.
- One logical change per commit. If staged changes cover unrelated things, suggest splitting first.
- Flag in the body when a commit adds a migration under `supabase/migrations/` or touches
  `packages/shared` — both affect multiple services.

### Tests
- Put the story/AC in the test description so coverage is traceable, e.g.
  `describe('SCRUM-14/AC2 venue capacity filter', ...)` (see Keep tests traceable above).

### Pull requests
- Target `main`. The `main` ruleset allows merge commits, squash and rebase, and the person merging
  picks: both merge commits and squashes are in `main`'s history. So every commit on the branch can end up
  on `main` and must follow the commit-title format, and so must the PR title, which becomes the
  commit when the PR is squashed — it should summarise the whole PR.
- Before opening, run `pnpm vitest run` (what CI runs) plus typecheck/lint for the workspaces you
  touched, and report any failures in the PR rather than hiding them.
- Open with `gh pr create --base main`. The body follows `.github/pull_request_template.md` — fill
  every section for this specific PR; don't leave placeholder text.
- **A PR description says why before what.** Start with the reason the PR exists: whose problem it
  solves, what goes wrong without it, and what changes for them. Then explain the choices behind the
  approach, with their trade-offs and any alternative you rejected. Keep "What changed" short, because
  the diff already shows what. A description that only lists files and features is incomplete. Wrong:
  "Adds a search box and a migration." Right: "Attendees had to scroll the whole list to find an event;
  this lets them narrow it as they type, which is why the filtering runs in the browser."

## UI redesign (epic SCRUM-119)
- One ticket per branch and per session: SCRUM-120 (theme tokens) → SCRUM-121 (app shell) → SCRUM-122…142 (features). Mock-ups: <https://www.figma.com/design/iHA0UaeAIYhfmfi0CrrJv6/ConnectSphere-UI-Mock-Ups?node-id=0-1&p=f&t=UZ5McDajOKDK0obz-0>.
- Stack: shadcn/ui + Tailwind in apps/web. Colors come from the Figma variables as CSS variables in globals.css; no hard-coded hex or arbitrary Tailwind values. shadcn components in src/components/ui, routes only in src/app.
- Layout: every role has the same left sidebar and no top bar; keep it in one shared shell component.
- Status is never color alone: always icon + label.
- Per ticket: read the ticket and its Figma frame, show a plan and wait for my OK, then build. Cite SCRUM-<story>/AC<n> in commits and test names, and finish by commenting on the ticket with the PR link and pass/fail per AC.
- PRs are written for a first-time reader who has not seen the ticket: plain language, no unexplained jargon or ticket-speak, why before what. Fill the template with an AC table (each AC as its Given/When/Then scenario, pass/fail and how it was checked, "not verified" when it was not) followed by a short INVEST check of the story (Independent, Negotiable, Valuable, Estimable, Small, Testable, each with a verdict); if a ticket's ACs are not Given/When/Then and independently testable, say so in the plan before building and "How to test" as numbered steps someone can follow by clicking. Say what is deliberately out of scope.

## Current state

Parts of the repo are still scaffolding — `notification-service` is the read side of in-app notifications only (SCRUM-46,
below); no email or SMS is sent yet, and the `healthCheck()` exports in
`services/*/src/index.ts` are leftovers from the original scaffold. `venue-service` is built out for the venue catalogue (SCRUM-29) and venue booking requests
(SCRUM-36, 32, 33, 35, 60, 59; spec in `docs/specs/venue-booking-request.md`, diagram in
`component-venue-service.puml`), and for the Venue Staff queue, approve and reject (SCRUM-37 to 39;
spec in `docs/specs/venue-booking-approval.md`). An event can hold several venue bookings (SCRUM-98; spec in `docs/specs/multiple-venue-bookings.md`, migration 28):
the one-per-event rule (DR6) is gone, the same venue for an overlapping period on one event is `DUPLICATE_VENUE`, a rejected
request has at most one active replacement (`ACTIVE_REQUEST_EXISTS`), each booking can have its own expected attendance and
venue requirements, more people than the venue holds is flagged (`exceedsCapacity`) rather than refused, and
`GET /events/:id/venue-bookings` lists an event's bookings for its page. One of them can be changed (`PATCH
/venue-bookings/:id`) or cancelled with a reason (`POST /venue-bookings/:id/cancel`) without touching the others (SCRUM-102;
spec in `docs/specs/change-cancel-venue-booking.md`), through the security definer functions `change_venue_booking()` and
`cancel_venue_booking()` (migration 30), only by the event's current coordinator and only before the event is Confirmed. A
change sends it back to PENDING and moves its equipment requests to the new time, back to Submitted; cancelling releases its
equipment requests (`cancelled`, shown as Released). Venue search (SCRUM-65; spec in `docs/specs/venue-search.md`) adds `GET /venues/search` backed by the
`available_venues` database function (`18_venue_search.sql`). Each venue has a setup and a turnaround time in whole minutes (SCRUM-101; spec in `docs/specs/venue-setup-turnaround.md`, migration 26): Venue Staff edit them on the venue detail page through `PUT /venues/:id/timing`, coordinators only read them, and they pad every booking (SCRUM-103; spec in `docs/specs/venue-padded-occupancy.md`, migration 27): a request, amendment or change is refused when its setup and turnaround overlap another booking's, the refusal names the occupied period, and `GET /venues/:id/availability` shows setup and turnaround apart from the event. Raising a venue's times flags the existing bookings that now clash (SCRUM-104; spec in `docs/specs/venue-buffer-conflicts.md`, migration 36): `set_venue_timing()` writes `venue_booking_flags` rows in the same transaction and `PUT /venues/:id/timing` lists the pairs, a flagged booking keeps its status but shows "Buffer conflict" to its coordinator and cannot be approved (`BOOKING_FLAGGED`, trigger code `CS104`; reject still works). Venue Staff can mark a venue temporarily unavailable (SCRUM-105; spec in `docs/specs/venue-unavailability.md`, migrations 38 and 39): only the `mark_venue_unavailable()` function writes `venue_unavailability`, a new request whose padded period touches a block is refused with `VENUE_UNAVAILABLE` (SQLSTATE `CS105`). The holding, future bookings already inside a new block are flagged "Venue unavailable – alternative needed" (SCRUM-106; spec in `docs/specs/venue-unavailability-flags.md`, migration 46): a trigger on `venue_unavailability` writes the `venue_booking_flags` rows inside `mark_venue_unavailable()` (which now returns the block id and `flagged_count`, and `POST /venues/:id/unavailability` adds `affectedBookings`), a second trigger writes one `venue_booking_flagged` notification for the event's assigned coordinator in the same transaction (ADR 0002), the booking and its event are untouched, and SCRUM-104's guard already stops a flagged Pending request being approved (reject still works). The assigned coordinator can then request a replacement venue for such a booking (SCRUM-107; spec in `docs/specs/replacement-venue.md`, migrations 47 and 48): `GET /venue-bookings/:id/replacement-candidates` lists the free venues big enough and `POST /venue-bookings/:id/replacement` creates a PENDING request linked to the original (even on a Confirmed event), and when Venue Staff approve it the `venue_booking_take_over()` trigger makes the original `replaced`, resolves its flag as `replaced` and moves its equipment requests to the replacement, back to Submitted. A venue can be checked against an event (SCRUM-109; spec in `docs/specs/venue-suitability.md`): `GET /venue-suitability` runs the shared `checkSuitability` (capacity, layout, operating hours and availability are judged; facilities and accessibility text are not checked yet). SCRUM-40 (suggested alternative) is not built: the
`Decision` type and `suggested_*` columns are its seam. `equipment-service` is built out for the
availability check (SCRUM-18; spec in `docs/specs/equipment-availability.md`; SCRUM-137 shares its counting rule,
`unitsFree()`, with a waiting request's "Available 4 / need 6" and the `GET /equipment-inventory` Inventory page, which name
the events holding units and any out-of-service reason; damage is per catalogue item, not per unit) and for reserving equipment
for an event (SCRUM-19; spec in `docs/specs/equipment-reservation.md`, saved atomically by the
`reserve_equipment()` function in migration 12; diagram in `component-equipment-service.puml`). An Event
Coordinator can also request equipment for their event (SCRUM-86; spec in `docs/specs/equipment-requests.md`): a
request is a `requested` row in `equipment_reservations`, for a catalogue item and one of the event's approved venue
bookings (`venue_booking_id`, migration 25), and migration 25's restrictive insert policy lets only the assigned
coordinator of an open event add one. The spec's open-question rules live in `packages/shared/src/equipmentRequest.ts`.
Technical Support Staff review requests (SCRUM-87; same spec): a queue at `/equipment-requests`, and a status change
through `review_equipment_request()` (migration 32), which refuses Arranged when too few units are free. The
assigned Event Coordinator can change a request (SCRUM-88; same spec): `update_equipment_request()` (migration 45) saves
the change and sends it back to Submitted, where Technical Support Staff see it marked Updated; AC7 (a new safety check)
when equipment changes after approval) can now build on SCRUM-99 and follows in its own change, and AC9 is not built. The event's coordinator assigns Technical Support Staff on-site (SCRUM-20; spec in
`docs/specs/technical-assignment-notifications.md`, migration 41): `technical_staff_assignments` rows for one of the event's
approved venue bookings, written only by `assign_technical_staff()`, `change_technical_assignment()` and
`cancel_technical_assignment()` (equipment-service `routes/technicalAssignments.ts`); a trigger writes the technician's
"assigned", "changed" and "cancelled" notifications in the same transaction (ADR 0002), and the technician acknowledges one
through notification-service (`POST /notifications/:id/acknowledge`, `acknowledge_technical_assignment()`), which marks the
assignment acknowledged until its venue booking or times change again. The
equipment catalogue and request notes (SCRUM-87/AC8) are not built yet.
`event-service` also lets an organiser submit an event change request (SCRUM-66; spec in
`docs/specs/event-change-request.md`, `routes/changeRequests.ts`, migration `15_event_change_requests_insert.sql`);
the event's assigned coordinator reviews it (SCRUM-67; spec in `docs/specs/review-change-request.md`,
`routes/changeRequestReview.ts`, migration 42): `GET /change-requests/:id` shows each requested change with the current value
(`readChangeRequest()` in `packages/shared/src/changeRequestReview.ts`), and `review_change_request()` either rejects it with a
required reason or approves it through `update_event_details()` in the same transaction, so an approval is recorded in the
change history and sends the affected arrangements back for review (SCRUM-112/113). A request the event has moved on from, or
one with a field the system cannot apply, can only be rejected. The assigned coordinator edits an event's details
(SCRUM-111; spec in `docs/specs/edit-event-details.md`, `routes/eventDetails.ts`, migration 34): ordinary fields (name, description,
purpose, category) and important ones (dates and times, attendance, layout, accessibility, venue and equipment requirements; the
lists are in `packages/shared/src/eventDetails.ts`), not for a completed, cancelled or rejected event. `update_event_details()` saves
the edit and a row in `event_change_history` together, which the event's coordinator and organiser can read. Migration 34 also adds
`events.venue_requirements`. Before an important change is saved, the coordinator sees which venue bookings and equipment
requests it may affect, and why (SCRUM-112; spec in `docs/specs/important-change-impact.md`, `affectedArrangements()` in
`packages/shared/src/eventImpact.ts`): `PATCH /events/:id` answers 409 `CONFIRM_IMPACT` with the list, and saves only when sent
again with `confirmImpact: true` (Save anyway). A raised attendance lists every active venue booking, all treated alike, and
Save anyway sends the listed ones back for review (SCRUM-113; spec in
`docs/specs/send-back-affected-arrangements.md`, migration 40): `update_event_details()` gains `p_send_back` and, in the same
step, returns those venue bookings to Pending (still holding their venue) and equipment requests to Submitted (units
released), stores what changed on each (`sent_back_changes`, `sent_back_at`, shown by `sentBackNote()` in
`packages/shared/src/sentBack.ts` on the Venue Staff queue and the Technical Support Staff review page), and returns a
Confirmed event to Planning when anything was sent back. A trigger clears the note on the next status change that is not
a send-back, so approving, rejecting, reviewing, changing or cancelling needs no change of its own. `auth-service` also serves a user's own profile
(SCRUM-68: `GET` and `PATCH /profile`; spec in `docs/specs/user-profile.md`): the profile email is a contact email,
separate from the Supabase Auth login email, and only name, contact email, phone and communication preferences
can be changed. Staff (internal users) also see their department and responsibilities
(SCRUM-69): the department is on their `users` row, and the responsibilities are stored once for each role in the
`role_responsibilities` table (migration 17). The attendee's List of events can be searched live (SCRUM-9; spec in `docs/specs/event-search.md`): the browser filters the cards as
the attendee types, using the organisation, category and coordinator names that `list_public_events()` now returns (migration 20). The
shared role list now has seven roles: the Event Coordinator Lead and the Safety Officer (week 7 customer
changes) exist as roles (migration 16). The Lead is being built out (spec in `docs/specs/event-coordinator-lead-role.md`):
it has a sign-in option, a home page and seeded accounts, and each Event Coordinator can be linked to the one Lead who
supervises them (`users.supervising_lead_id`, migration 19; SCRUM-75). Leads share one unassigned queue (SCRUM-77,
`lead_unassigned_queue()` in migration 21). A closed event is completed, cancelled or rejected: `CLOSED_EVENT_STATUSES` in
`packages/shared` and `is_closed_event_status()` in migration 21, kept equal by a test. A Lead sees their active
coordinators' workload and non-closed events (SCRUM-81, migration 22). Only a Lead assigns (SCRUM-78, migration 23) or
reassigns (SCRUM-79, migration 24) an event's coordinator, and only to their own active coordinators; the
`events_assignment_guard` trigger enforces it for every caller. This replaced SCRUM-42's coordinator self-claim and
SCRUM-41's hand-over: the coordinators' `/events/:id/assign-coordinator` and `/eligible-coordinators` routes now only
refuse. A Safety Officer runs the Operational Safety Check (SCRUM-99; spec in `docs/specs/operational-safety-check.md`,
`routes/safetyChecks.ts`, migration 37): `/safety-checks` lists the events ready for a check (awaiting arrangements, every
active venue booking approved, every equipment request arranged, no decision yet), `/safety-checks/[id]` shows the safety
information (migration 37 adds `venues.emergency_access` and `venues.restrictions`) and records Approve, Reject (reason
required) or Request Changes (comment required) in `safety_checks`. The `events_safety_gate` trigger stops anyone, the
service role included, moving an event to confirmed until its latest decision is approved. Request Changes (SCRUM-100,
migration 43) moves the event back to planning; once the coordinator returns it to awaiting arrangements with its
arrangements complete, it is back in the queue for another check. The event's coordinator and organiser see every
safety decision on the event page (`GET /events/:id/safety-decisions`, `event_safety_decisions()`). An important change to an
approved event revokes the approval (`safety_checks.revoked_at`, migration 43's trigger), so it needs another check; a
confirmed event goes back to awaiting arrangements. Organisers and coordinators see the registrations of the events they manage on `/registrations-overview`
(SCRUM-74): `GET /events/managed` lists an organiser's own or a coordinator's assigned events, and the page shows the chosen
event's registrations newest first, with a summary in which only Confirmed registrations use a slot.

Users can view and manage their own in-app notifications (SCRUM-46; spec in `docs/specs/notifications.md`, ADR 0002):
`notification-service` serves `GET /notifications`, `GET /notifications/unread-count` and `POST /notifications/:id/read`,
`notifications` is own-rows RLS (migration 35), the page is `/notifications`, and the bell in every signed-in page's header (`AppHeader`, `NotificationBell`) shows the unread count and a dropdown of them that links to it. SCRUM-47 (spec in
`docs/specs/receive-notifications.md`, migration 44) adds the producers, triggers that write each row in the same transaction as
its change: a coordinator's assignment, an event request's approval or rejection, a comment mention or reply (one per person,
never the author; comments are saved through `post_event_comment()`), a clarification request and the organiser's answer (a
comment the assigned coordinator flags, `event_comments.is_clarification_request`), and a safety decision. Each item carries
`actionRequired` (`notificationRequiresAction()` in `packages/shared`). SCRUM-172 (same spec, migration 65) adds the remaining
producers, also triggers: a submitted request tells every active Lead; a venue booking approved or rejected tells the assigned
coordinator; an important change tells the organiser and coordinator; a registration status change tells the attendee; a confirmed
event tells the organiser and coordinator; a cancelled one tells them and the attendees; a buffer conflict tells the coordinator of
each flagged booking; a replacement venue tells the organiser and attendees. Nobody is told about their own action, and a withdrawn
attendee hears nothing (`event_update_attendees()`, kept equal to `receivesEventUpdates()` by a test). An attendee's event
notification opens `/registrations`, because the event page refuses them.

Known gaps to fix rather than work around:
- RLS policies are blanket placeholders (`supabase/migrations/02_rls.sql`): every table allows any
  authenticated user full access to every row. `03_users_role_privilege.sql` closed the `role`
  escalation on `users` specifically (column-level grant, not a row-level policy — see that
  file's comment for why), but every table, including `users`, still allows any authenticated
  user to read/edit any *row*. Replace the blanket row access with per-role/own-row policies in a
  new migration. `events` and its history tables (SCRUM-91; a coordinator reads only the events assigned to them, SCRUM-156,
  migration 59), `users` (SCRUM-154), `venue_bookings`, `event_registrations`, `notifications`, `equipment_reservations` and
  `technical_support_requests` (SCRUM-153) and the catalogues (SCRUM-155, migration 53: Venue Staff write venues, layouts and
  facilities, Technical Support Staff write equipment, nobody writes `organisations` or `event_categories` through the API)
  already have per-role policies; what is deliberately left open (reads of the reference data, `activity_log`), and that a
  Lead reads only unassigned events and their own coordinators' rather than every event, are in
  [ADR 0003](docs/architecture/adr/0003-row-level-security-as-authorisation.md).


## 