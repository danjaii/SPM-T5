# ConnectSphere

Event management platform — a Next.js/React frontend and five Node/TypeScript microservices, all
backed by one Supabase Postgres.

**Repository:** <https://github.com/danjaii/SPM-T5>. It is a public repository, so both course instructors can
read the code, the pull requests and the history without being added first. The team members are collaborators.
Where the project work is tracked: Jira project `SCRUM` (every commit and PR cites `SCRUM-<story>/AC<n>`; see
[Contributing](#contributing)).

## Contents

- [Architecture overview](#architecture-overview)
- [Services](#services)
- [Roles](#roles)
- [Repo layout](#repo-layout)
- [Getting started](#getting-started)
- [Feature walkthroughs](#feature-walkthroughs)
- [Testing](#testing)
- [Contributing](#contributing)
- [CI](#ci)
- [Database](#database)
- [Current status](#current-status)
- [Dependency notes](#dependency-notes)
- [AI coding agents](#ai-coding-agents)

## Architecture overview

- **Each service is independently testable and deployable.** `services/*` are standalone
  Node/TypeScript packages, each with their own `package.json`, `tests/`, and `Dockerfile`.
  A new service is picked up by CI automatically (`pnpm vitest run` discovers every workspace's tests).
- **`packages/shared`** holds the Supabase client wrapper, generated DB types, and cross-cutting
  utilities (auth/role guards, validation schemas) so services and the frontend don't drift.
- **`apps/web`** is the Next.js app. It calls services directly over HTTP — no API gateway, no BFF.
- **Supabase owns auth and authorization.** Supabase Auth (GoTrue) holds all credentials and issues
  JWTs; `auth-service` wraps it rather than reimplementing it. Access control is enforced by
  Row-Level Security in Postgres, not by Express middleware.
- **C4 diagrams live in `docs/architecture/c4`** as PlantUML source (`.puml`), version-controlled
  like code, and auto-rendered to SVG/PNG by CI on every change (see
  [`docs/architecture/README.md`](docs/architecture/README.md)).

## Services

| Service | Port | Owns |
| ----- | ----- | ----- |
| `web` (`apps/web`) | 3000 | Next.js frontend |
| `auth-service` | 4001 | Authentication/authorisation, wrapping Supabase Auth |
| `event-service` | 4002 | Event requests, drafts, review/approval, status state machine, coordinator assignment, change requests |
| `venue-service` | 4003 | Venue catalogue, availability calendar, search, suitability checks, bookings and conflict detection |
| `equipment-service` | 4004 | Equipment catalogue, availability checks, reservations, technical support (formerly `coordinator-service`) |
| `notification-service` | 4005 | In-app notifications (list, mark read, acknowledge) and the hold expiry notices; in-app only, no email or SMS |

Attendee registration (SCRUM-83) is owned by `event-service`.

## Roles

Defined in `packages/shared/src/roles.ts`. Add new roles there, not as string literals in a service.

| Role | Who | What they do |
| ----- | ----- | ----- |
| `event_organiser` | External | Creates and edits event requests (drafts and submitted), tracks approval, requests changes after submission, registers attendees |
| `event_coordinator` | Internal | Manages the events assigned to them: reviews and approves requests, searches venues, submits venue and equipment requests |
| `event_coordinator_lead` | Internal | Oversees incoming requests (the unassigned queue), assigns and reassigns coordinators |
| `venue_staff` | Internal | Maintains the venue catalogue and layout types, approves or rejects venue bookings, flags venue unavailability |
| `technical_support_staff` | Internal | Maintains the equipment catalogue, reviews equipment requests, reserves equipment, handles maintenance statuses |
| `safety_officer` | Internal | Runs the Operational Safety Check before an event can be confirmed |
| `attendee` | External | Browses confirmed public events, registers and withdraws |

## Repo layout

```
SPM-T5/
├── .agents/
│   └── skills/               # Agent skills (supabase-server, test-driven-development, ...)
├── .github/
│   └── workflows/            # CI: ci.yml (lint, typecheck, tests, build, integration, e2e) + C4 diagram rendering
├── apps/
│   └── web/                  # Next.js/React frontend
│       ├── public/           # Static assets, served at /
│       ├── src/
│       │   ├── app/          # App Router routes only (every folder is a URL segment)
│       │   ├── components/   # React components
│       │   └── lib/          # Browser/server helpers
│       ├── tests/            # unit/ (Vitest + Testing Library), e2e/ (Playwright)
│       ├── eslint.config.mjs # ESLint flat config (next/core-web-vitals + next/typescript)
│       ├── playwright.config.ts
│       └── vitest.config.ts
├── services/                 # One folder per microservice
│   ├── auth-service/
│   ├── event-service/
│   ├── venue-service/
│   ├── equipment-service/
│   └── notification-service/
├── packages/
│   └── shared/               # Shared types, Supabase client, utils used by web + services
├── supabase/
│   ├── migrations/           # SQL migrations (source of truth for schema)
│   └── seed.sql
├── docs/
│   ├── architecture/
│   │   ├── c4/               # C4 model (PlantUML) — context, container, component diagrams
│   │   └── adr/              # Architecture Decision Records
│   └── specs/                # Feature specs (user stories, acceptance criteria)
├── CLAUDE.md                 # Instructions for AI coding agents (the file to edit)
├── AGENTS.md -> CLAUDE.md    # Symlink so Codex and other agents read the same file
└── docker-compose.yml        # Local dev: all services + web (Supabase runs via `supabase start`)
```

## Getting started

### Prerequisites

- **Node 20+** (CI runs Node 20; the database integration tests need Node 22, since Node 20 lacks the
  native WebSocket `@supabase/realtime-js` uses) and **pnpm**. The pnpm version
  is pinned by `packageManager` in the root `package.json`; run `corepack enable` once to use it.
- **Docker Desktop**, running, for the local Supabase stack and `docker compose`.
- The [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started):
  `scoop install supabase` or `npm i -g supabase` on Windows, `brew install supabase/tap/supabase` on macOS.
- **Windows only:** git checks symlinks out as plain text files unless symlinks are enabled (this
  affects `AGENTS.md`). Turn on Developer Mode and run `git config core.symlinks true` before cloning,
  or work in WSL.

The repo is a pnpm workspaces monorepo — run `pnpm install` once from the root to install every workspace.

### Environment variables

Create a `.env` at the repo root (fill it in at step 4 of [Run locally](#run-locally)). It is
git-ignored; the auth, event and venue services read it via `--env-file=../../.env` and
`docker-compose.yml` loads it into every service container (not `web`, which only gets the public
URL/key as build args).

```bash
# Supabase
SUPABASE_URL=                # local: http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=    # sb_publishable_...
SUPABASE_SECRET_KEY=         # sb_secret_... — bypasses RLS, server-side only
SUPABASE_JWKS_URL=

# apps/web reaches each service at http://localhost:<port> by default (ports in the services table above); set
# NEXT_PUBLIC_NOTIFICATION_SERVICE_URL (browser) or NOTIFICATION_SERVICE_URL (Next.js server, e.g. in docker compose)
# to override notification-service's address (default http://localhost:4005), like the other services.

# Origin the services allow for CORS — the web app must run here (optional, this is the default)
WEB_ORIGIN=http://localhost:3000

# Notification provider
EMAIL_PROVIDER_API_KEY=

# Only for `docker compose` + local `supabase start`: containers can't reach your
# machine's localhost, so they use this instead of SUPABASE_URL.
# DOCKER_SUPABASE_URL=http://host.docker.internal:54321
```

For a local Supabase, `supabase status -o env` prints the URL and keys to copy in
(`API_URL`, `PUBLISHABLE_KEY`, `SECRET_KEY`).

### Run locally

1. `pnpm install`
2. `supabase start` — the first run pulls images (a few minutes) and applies `supabase/migrations`,
   then `seed.sql`.
3. `supabase status -o env` — prints the URL and keys for the next step.
4. Fill in `.env` (see above) with those values.
5. From the **repo root** (not `apps/web`): `pnpm dev`. This runs web on 3000, auth-service on 4001,
   event-service on 4002, venue-service on 4003, equipment-service on 4004 and notification-service on 4005.
   Inside `apps/web`, `pnpm dev` starts only the web app. To run one service on its own, use
   `pnpm --filter @spm-t5/<service> run dev`.

Stop any older dev server first: the web app must be on port 3000, the origin the services allow. If
the sign-in page shows "We couldn't reach the server", auth-service isn't running (login needs it on
4001, and the event page needs event-service on 4002 and venue-service on 4003). The notification bell in the page
header has no number and can't load its list when notification-service isn't running on 4005.

Alternatively, `docker compose up -d` starts the five services and web (it does not include Supabase).
Each Dockerfile sets `PORT=4000`, which the compose port mappings (`4001:4000` and so on) rely on.

Useful Supabase commands:

```bash
supabase db reset   # re-apply all migrations + seed from scratch (do this after adding a migration)
supabase stop       # shut the stack down (add --no-backup to also drop its data)
```

Supabase Studio is at http://127.0.0.1:54323.

### Seeded accounts

Sign in with any seeded account (`supabase/seed.sql`) — password `ConnectSphere2026!` — and pick the
matching role:

| Role | Email |
| ----- | ----- |
| Event Coordinator | `rachel.tan@connectsphere.example.com` |
| Event Coordinator Lead | `helen.ong@connectsphere.example.com` (a second Lead, `samuel.tay@...`, has their own coordinators) |
| Venue Staff | `kenneth.wong@connectsphere.example.com` |
| Event Organiser | `jason.chua@techconnect.example.com` |
| Technical Support Staff | `aaron.koh@connectsphere.example.com` |
| Safety Officer | `farah.ismail@connectsphere.example.com` |
| Attendee | `alicia.fernandez@example.com` |

Notes:

- The role you pick must match the account's role, otherwise you get the same generic error as a wrong password.
- Registering creates a real user in that Supabase project, and Supabase emails a verification link
  (unless confirmations are switched off in the project's Auth settings).
- "Forgot password" emails a link to `http://localhost:3000/reset-password`; add that URL to the
  project's Auth → URL Configuration → Redirect URLs.
- The session is an httpOnly cookie set by auth-service; logging out revokes it in Supabase.

## Feature walkthroughs

Both walkthroughs assume the stack from [Run locally](#run-locally) is up and you are signed in with
a [seeded account](#seeded-accounts).

### Authentication (US1–US4: sign in, register, role dashboards, logout)

Implemented by `services/auth-service` (Express, wraps Supabase Auth) and the sign-in/register/dashboard
pages in `apps/web`. The sign-in page calls auth-service directly, so both must be running.

### Venue booking requests (SCRUM-36, 32, 33, 35, 60, 59)

The whole coordinator flow end to end: web, auth, event and venue services against a local Supabase.
Spec: [`docs/specs/venue-booking-request.md`](docs/specs/venue-booking-request.md).

- **Submit and track (32, 33, 36):** sign in as the Event Coordinator (`rachel.tan@...`), open an event
  assigned to her whose status is `approved`, `planning` or `awaiting_arrangements` (other statuses are
  refused with `EVENT_NOT_ELIGIBLE`), and use the venue request link on its status panel. Submit, then
  check the list and detail pages. Submit an overlapping slot to see the conflict message.
- **Withdraw (35):** on a pending request, choose Withdraw request and confirm.
- **Amend and accept a suggestion (60, 59):** these need a rejected request that carries a suggested
  alternative. Sign in as Venue Staff (`kenneth.wong@...`), open the request from the booking queue
  (`/booking-queue`), choose Reject request, give a reason, tick **Suggest an alternative** and pick a venue, a date
  and times (SCRUM-40). Then reload the request as the coordinator: it shows the suggestion, with **Accept
  suggested alternative** and **Amend request**. A suggestion does not hold the venue, so another coordinator can
  still request it.

- **Access control:** open the same request as the organiser or as another coordinator. You get "not
  found" rather than the request (RLS; see the spec's "Not visible means not found").

To run the automated checks instead, see [Testing](#testing).

## Testing

Unit and integration tests use Vitest; `apps/web` end-to-end tests use Playwright.

```bash
pnpm vitest run                                    # every workspace's tests + coverage report in ./coverage (what CI runs)
pnpm run test:all                                  # same tests, one workspace at a time
pnpm --filter @spm-t5/event-service run test       # one workspace
pnpm --filter @spm-t5/auth-service run test:unit   # unit only
pnpm --filter @spm-t5/auth-service run test:integration
pnpm --filter @spm-t5/web run test:unit            # web unit tests only (tests/unit)
pnpm --filter @spm-t5/web run test:e2e             # Playwright (tests/e2e)
```

The root `vitest.config.mts` lists the workspaces as Vitest projects, so `pnpm vitest run` finds all their tests.
`apps/web/vitest.config.ts` only picks up `tests/unit/**` (jsdom + Testing Library), so Vitest
doesn't try to run the Playwright specs. `apps/web/playwright.config.ts` starts the five services (ports 4101-4105
locally, so your own dev servers on 4001-4005 are left alone) and `next dev` on port 3000 itself, so `test:e2e` needs
no separately running server. It does need the local Supabase running (`supabase start`) and the root `.env`; run
`npx playwright install chromium` once to fetch the browser. Port 3000 must be free, or set `E2E_REUSE_WEB=1` to reuse
a web server you started with the E2E service ports.

### Database integration tests (local Supabase)

`services/venue-service/tests/integration` runs against a real Postgres, so the migrations and
constraints (slot exclusion, one active request per event) are checked for real. Without
`SUPABASE_URL` and `SUPABASE_SECRET_KEY` these suites **skip silently**, so a green plain
`pnpm vitest run` does not prove they passed. CI runs them in the `integration` job.

Start Supabase (see [Prerequisites](#prerequisites) and [Run locally](#run-locally)), then point the
tests at it and run them from the **repo root** (running through `pnpm --filter` fails to resolve the
root Vitest projects):

```bash
# bash / WSL
export SUPABASE_URL="<API_URL from status>"        # http://127.0.0.1:54321
export SUPABASE_SECRET_KEY="<SECRET_KEY from status>"
export SUPABASE_PUBLISHABLE_KEY="<PUBLISHABLE_KEY from status>"   # RLS tests sign in as seeded users
# PowerShell
$env:SUPABASE_URL = "<API_URL>"; $env:SUPABASE_SECRET_KEY = "<SECRET_KEY>"; $env:SUPABASE_PUBLISHABLE_KEY = "<PUBLISHABLE_KEY>"
# cmd.exe (no quotes; `set` only lasts for this window, so run the tests from the same one)
set SUPABASE_URL=<API_URL>
set SUPABASE_SECRET_KEY=<SECRET_KEY>
set SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY>

pnpm vitest run --project @spm-t5/venue-service tests/integration --coverage.enabled=false
```

The RLS suite (`bookingRls.test.ts`) also needs `SUPABASE_PUBLISHABLE_KEY`: it signs in as seeded users
(password `ConnectSphere2026!`) and queries with their JWTs, and throws if the key is missing.

Tests create their own `IT-` prefixed venues and events in 2030 and clean up after themselves. If
the run reports "Need a seeded event_organiser", the seed is missing: run `supabase db reset`.

## Contributing

Work is traced back to Jira stories, so a few conventions apply to every change:

- **Git conventions** — branch names, commit and PR titles, and ticket references
  (`SCRUM-<story>/AC<n>`) are defined in the "Git conventions" section of [`CLAUDE.md`](CLAUDE.md).
  PRs target `main` and follow `.github/pull_request_template.md`. The person merging picks a merge commit,
  a squash or a rebase, so every commit on a branch and the PR title must follow the format (the PR title
  becomes the commit when the PR is squashed).
- **Specs** — feature specs (user stories, acceptance criteria, shared rules) live in
  [`docs/specs/`](docs/specs/). Test names reference the spec's scenario IDs (e.g. `36-S4`); where a
  spec disagrees with the schema, its "Implementation decisions" section wins.
- **Tests first** — the team's TDD workflow is the skill at
  [`.agents/skills/test-driven-development/SKILL.md`](.agents/skills/test-driven-development/SKILL.md)
  (see also `writing-good-tests.md` beside it). Put the story/AC in test descriptions, e.g.
  `describe('SCRUM-14/AC2 venue capacity filter', ...)`.

## CI

A single workflow, `.github/workflows/ci.yml`, runs on every push to `main` and every PR into it,
covering every workspace:

| Job | Node | What it does |
| ----- | ----- | ----- |
| `test` | 20 | Lint, type check, unit/integration tests with coverage, build |
| `integration` | 22 | Starts local Supabase and runs the database integration tests |
| `e2e` | 22 | Starts local Supabase, builds the services and the web app, and runs the Playwright end-to-end tests through the whole stack (runs after `test`) |
| `migrate` | — | Push to `main` only, after `test` and `integration`: applies new migrations to the hosted Supabase project (needs the `SUPABASE_DB_URL` secret) |

Every PR must pass the `CI / test` and `CI / e2e` checks before merge (see branch protection notes in
[`.github/workflows/README.md`](.github/workflows/README.md)). A separate workflow renders the C4 diagrams.

## Database

`supabase/migrations/` is the schema source of truth and is append-only — add a new numbered file
rather than editing an applied one.

**Merging to `main` is how a migration reaches the hosted Supabase project.** The CI `migrate` job runs
`supabase db push` after the tests pass. Don't run migration SQL in the dashboard SQL editor: it runs but
isn't recorded, so the next push re-runs it (and fails) or skips another file. To see what is applied
(read-only): `supabase migration list --db-url "<session pooler connection string>"`.

Migrations run in number order (`01_schema.sql`, `02_rls.sql`, ... ) and a number is used once: CI fails when
two files share one (`scripts/check-migration-numbers.sh`), so before adding a migration take the next number
after the newest file on `main`, and renumber if another PR merges first. Gaps in the numbering are fine.

Rather than a table that goes out of date, each file explains itself: it opens with a comment naming the story
it belongs to, what it changes and why. Where to look:

- **Tables and types:** `01_schema.sql`.
- **Row-level security** (the authorisation model, [ADR 0003](docs/architecture/adr/0003-row-level-security-as-authorisation.md)):
  `02_rls.sql` was a blanket placeholder; each later migration replaces it for one area, for example
  `14_events_rls.sql`, `07_venue_bookings_rls.sql`, `35_notifications_own_rows.sql`, `52_users_contact_privacy.sql`,
  `53_catalogue_write_roles.sql` and `59_coordinator_event_reads.sql`.
- **Rules kept in the database** so no service can skip them: for example the venue booking overlap trigger
  (`27_*`), the safety gate on `Confirmed` (`37_*`), atomic reserve and change functions (`12_*`, `30_*`).
- **Seed data:** `supabase/seed.sql`, which also creates the accounts above.

`supabase db reset` rebuilds the local database from all of them.

## Current status

This is the release-1 build. All five services and `apps/web` are built out for the 20 release-1 features; what
each story built is recorded in its spec in [`docs/specs/`](docs/specs/), the C4 diagrams in
[`docs/architecture/c4/`](docs/architecture/c4/) and [`docs/traceability.md`](docs/traceability.md). Requirements that were left out on purpose are in
[`docs/scope-decisions.md`](docs/scope-decisions.md).

In short: `notification-service` serves a user's own in-app notifications (list, unread count, mark read) on
port 4005, and writes the hold expiry notices every minute (SCRUM-108). Notifications are in-app only: email and SMS
are not part of this project.
Authorisation is Row-Level Security with per-role, own-row policies on the tables that hold people's data;
what is deliberately left open is explained in ADR 0003.

## Dependency notes

- **`postcss` is pinned via `overrides` in `pnpm-workspace.yaml`.** Next 15 pins a PostCSS version with known
  advisories; the override forces a patched release without a breaking upgrade to Next 16. Drop
  it once Next ships a fixed PostCSS.
- **Vitest is on 4.x, not 5.x.** Vitest 5 requires Node 22+, and the `test` CI job runs Node 20 (`e2e` runs Node 22 because the services it starts need a native WebSocket).
  Bump both together. The same applies to `jsdom` (kept on 29.x; 30+ needs Node 22+).
- **`next-env.d.ts` and `*.tsbuildinfo` are git-ignored.** Next generates them; `pnpm --filter @spm-t5/web
  run typecheck` runs `next typegen` first so it works on a fresh checkout.
- Don't blanket-apply audit fixes — they can force major-version upgrades (Next, Vitest) across the
  whole monorepo. Fix advisories deliberately, one PR each.

## AI coding agents

Project instructions for coding agents live in [`CLAUDE.md`](CLAUDE.md), which Claude Code reads.
`AGENTS.md` is a symlink to it, so OpenAI Codex (and other tools that read `AGENTS.md`) get the
same instructions. Edit `CLAUDE.md` only — never replace the `AGENTS.md` symlink with a copy. On
Windows, see the symlink note under [Prerequisites](#prerequisites).
