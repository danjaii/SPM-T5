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
`receivesEventUpdates()` in `packages/shared` is the rule notification-service should use so a
withdrawn attendee gets no more updates or reminders.

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
- **Export the Express app separately from `listen()`** so integration tests can mount it without
  binding a port.
- **`src/app/` in `apps/web` is routes only** — every folder is a URL segment. Components go in
  `src/components/`, browser helpers in `src/lib/`.
- **Architecture changes need a diagram or ADR update.** Flag it in the PR;
  `docs/architecture/c4/rendered/` is CI-generated, so edit the `.puml` source only.
  `docs/architecture/c4/` currently covers C1 (`context.puml`), C2 (`container.puml`), and one C3
  (`component-event-service.puml`) — add a component diagram per service as it gets built out,
  rather than a C4 code diagram.
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
- Target `main`. PRs are **squash-merged**, so the PR title becomes the single commit on `main` —
  it must follow the commit-title format and summarise the whole PR.
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

## Current state

Parts of the repo are still scaffolding — `notification-service` listens on its port but only serves
`GET /health` (no notifications are sent yet), and the `healthCheck()` exports in
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
`available_venues` database function (`18_venue_search.sql`). Each venue has a setup and a turnaround time in whole minutes (SCRUM-101; spec in `docs/specs/venue-setup-turnaround.md`, migration 26): Venue Staff edit them on the venue detail page through `PUT /venues/:id/timing`, coordinators only read them, and they pad every booking (SCRUM-103; spec in `docs/specs/venue-padded-occupancy.md`, migration 27): a request, amendment or change is refused when its setup and turnaround overlap another booking's, the refusal names the occupied period, and `GET /venues/:id/availability` shows setup and turnaround apart from the event. SCRUM-40 (suggested alternative) is not built: the
`Decision` type and `suggested_*` columns are its seam. `equipment-service` is built out for the
availability check (SCRUM-18; spec in `docs/specs/equipment-availability.md`) and for reserving equipment
for an event (SCRUM-19; spec in `docs/specs/equipment-reservation.md`, saved atomically by the
`reserve_equipment()` function in migration 12; diagram in `component-equipment-service.puml`). An Event
Coordinator can also request equipment for their event (SCRUM-86; spec in `docs/specs/equipment-requests.md`): a
request is a `requested` row in `equipment_reservations`, for a catalogue item and one of the event's approved venue
bookings (`venue_booking_id`, migration 25), and migration 25's restrictive insert policy lets only the assigned
coordinator of an open event add one. The spec's open-question rules live in `packages/shared/src/equipmentRequest.ts`.
The equipment catalogue, and reviewing and editing requests (SCRUM-87, SCRUM-88), are not built yet.
`event-service` also lets an organiser submit an event change request (SCRUM-66; spec in
`docs/specs/event-change-request.md`, `routes/changeRequests.ts`, migration `15_event_change_requests_insert.sql`);
approving or rejecting a request, and applying it to the event, is not built yet. The assigned coordinator edits an event's details
(SCRUM-111; spec in `docs/specs/edit-event-details.md`, `routes/eventDetails.ts`, migration 34): ordinary fields (name, description,
purpose, category) and important ones (dates and times, attendance, layout, accessibility, venue and equipment requirements; the
lists are in `packages/shared/src/eventDetails.ts`), not for a completed, cancelled or rejected event. `update_event_details()` saves
the edit and a row in `event_change_history` together, which the event's coordinator and organiser can read. Migration 34 also adds
`events.venue_requirements`. Before an important change is saved, the coordinator sees which venue bookings and equipment
requests it may affect, and why (SCRUM-112; spec in `docs/specs/important-change-impact.md`, `affectedArrangements()` in
`packages/shared/src/eventImpact.ts`): `PATCH /events/:id` answers 409 `CONFIRM_IMPACT` with the list, and saves only when sent
again with `confirmImpact: true` (Save anyway). A raised attendance lists every active venue booking, all treated alike, and
nothing changes the arrangements. Sending the affected ones back for review is SCRUM-113. `auth-service` also serves a user's own profile
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
refuse. The Safety Officer has no accounts, dashboard or
sign-in option yet. Organisers and coordinators see the registrations of the events they manage on `/registrations-overview`
(SCRUM-74): `GET /events/managed` lists an organiser's own or a coordinator's assigned events, and the page shows the chosen
event's registrations newest first, with a summary in which only Confirmed registrations use a slot.

Known gaps to fix rather than work around:
- RLS policies are blanket placeholders (`supabase/migrations/02_rls.sql`): every table allows any
  authenticated user full access to every row. `03_users_role_privilege.sql` closed the `role`
  escalation on `users` specifically (column-level grant, not a row-level policy — see that
  file's comment for why), but every table, including `users`, still allows any authenticated
  user to read/edit any *row*. Replace the blanket row access with per-role/own-row policies in a
  new migration. `07_venue_bookings_rls.sql` does this for `venue_bookings` and
  `11_event_registrations.sql` for `event_registrations`; the other tables are still blanket
  (tracked in SCRUM-91, SCRUM-92 and SCRUM-93).


## 