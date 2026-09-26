# ConnectSphere

Event management platform — Next.js/React frontend, Supabase-backed microservices.

## Repo layout

```
SPM-T5/
├── .agents/
│   └── skills/               # Agent skills (e.g. supabase-server)
├── .github/
│   └── workflows/            # CI pipelines (one per service + frontend, path-filtered)
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
│   └── shared/                # Shared types, Supabase client, utils used by web + services
├── supabase/
│   ├── migrations/            # SQL migrations (source of truth for schema)
│   └── seed.sql
├── docs/
│   ├── architecture/
│   │   ├── c4/                 # C4 model (PlantUML) — context, container, component diagrams
│   │   └── adr/                # Architecture Decision Records
│   └── sprints/                # Sprint planning/retro notes
├── CLAUDE.md                   # Instructions for AI coding agents (the file to edit)
├── AGENTS.md -> CLAUDE.md      # Symlink so Codex and other agents read the same file
└── docker-compose.yml          # Local dev: all services + web (Supabase runs via `supabase start`)
```

## Why this shape

- **Each service is independently testable and deployable.** `services/*` are standalone
  Node/TypeScript packages, each with their own `package.json`, `tests/`, and `Dockerfile`.
  This matches the microservice architecture and lets CI run only the tests affected by a
  given change (see path filters in `.github/workflows/`).
- **`packages/shared`** holds the Supabase client wrapper, generated DB types, and cross-cutting
  utilities (auth/role guards, validation schemas) so services and the frontend don't drift.
- **`apps/web`** is the Next.js app. It calls services directly over HTTP — no API gateway, no BFF.
- **Supabase owns auth and authorization.** Supabase Auth (GoTrue) holds all credentials and issues
  JWTs; `auth-service` wraps it rather than reimplementing it. Access control is enforced by
  Row-Level Security in Postgres, not by Express middleware.
- **Automated testing runs on every push/PR**, scoped to whatever changed, so a new feature in
  `event-service` doesn't wait on unrelated frontend tests, and vice versa. See
  [`.github/workflows/README.md`](.github/workflows/README.md).
- **C4 diagrams live in `docs/architecture/c4`** as PlantUML source (`.puml`), version-controlled
  like code, and are auto-rendered to SVG/PNG by CI on every change (see
  [`docs/architecture/README.md`](docs/architecture/README.md)).

## Services

| Service | Port | Owns |
| ----- | ----- | ----- |
| `auth-service` | 4001 | Authentication/authorisation, wrapping Supabase Auth |
| `event-service` | 4002 | Event requests, drafts, review/approval, status state machine, coordinator assignment, change requests |
| `venue-service` | 4003 | Venue catalogue, availability calendar, search, suitability checks, bookings and conflict detection |
| `equipment-service` | 4004 | Equipment catalogue, availability checks, reservations, technical support (formerly `coordinator-service`) |
| `notification-service` | 4005 | In-app/email notifications, triggered by event-service status changes |

Attendee registration is not yet assigned to a service (most likely `event-service`) — see
[`CLAUDE.md`](CLAUDE.md).

## Roles

Defined in `packages/shared/src/roles.ts`: `event_organiser`, `event_coordinator`, `venue_staff`,
`technical_support_staff` and `attendee`. Add new roles there, not as string literals in a service.

## Database

`supabase/migrations/` is the schema source of truth and is append-only — add a new numbered file
rather than editing an applied one.

| Migration | Purpose |
| ----- | ----- |
| `01_schema.sql` | Tables; `users.id` references `auth.users(id)` |
| `02_rls.sql` | RLS policies — currently blanket placeholders |
| `03_users_role_privilege.sql` | Column-level grant preventing users from escalating their own `role` |

## Current status

This is the release-1 scaffold. Most services only export a `healthCheck()` stub and do not yet
call `listen()`, so their containers exit immediately under `docker compose up`. RLS policies
still let any authenticated user access every row; per-role/own-row policies are pending.

## AI coding agents

Project instructions for coding agents live in [`CLAUDE.md`](CLAUDE.md), which Claude Code reads.
`AGENTS.md` is a symlink to it, so OpenAI Codex (and other tools that read `AGENTS.md`) get the
same instructions. Edit `CLAUDE.md` only — never replace the `AGENTS.md` symlink with a copy.

On Windows, git checks symlinks out as plain text files unless symlinks are enabled: turn on
Developer Mode and run `git config core.symlinks true` before cloning, or work in WSL.

## Getting started

Requires Node 20+ (CI runs Node 20) and pnpm (the version is pinned by `packageManager` in the root `package.json`; run
`corepack enable` once to use it). The repo is a pnpm workspaces monorepo — run `pnpm install` once
from the root.

```bash
pnpm install            # installs all workspaces
supabase start          # local Supabase stack via the Supabase CLI (optional, for full-stack dev)
docker compose up -d    # the five services + web (does not include Supabase)
pnpm --filter @spm-t5/web run dev
```

Create a `.env` at the repo root (git-ignored; `docker-compose.yml` loads it into every service
container — not `web`, which only gets the public URL/key as build args) with:

```bash
# Supabase
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=   # sb_publishable_...
SUPABASE_SECRET_KEY=        # sb_secret_... — bypasses RLS, server-side only
SUPABASE_JWKS_URL=

# Notification provider
EMAIL_PROVIDER_API_KEY=

# Only for `docker compose` + local `supabase start`: containers can't reach your
# machine's localhost, so they use this instead of SUPABASE_URL.
# DOCKER_SUPABASE_URL=http://host.docker.internal:54321
```

Service ports: auth 4001, event 4002, venue 4003, equipment 4004, notification 4005, web 3000.

## Testing

Unit and integration tests use Vitest; `apps/web` end-to-end tests use Playwright.

```bash
pnpm run test:all                               # every workspace
pnpm --filter @spm-t5/event-service run test   # one workspace
pnpm --filter @spm-t5/auth-service run test:unit   # unit only
pnpm --filter @spm-t5/auth-service run test:integration
pnpm --filter @spm-t5/web run test:e2e          # Playwright (tests/e2e)
```

`apps/web/vitest.config.ts` only picks up `tests/unit/**` (jsdom + Testing Library), so Vitest
doesn't try to run the Playwright specs. `apps/web/playwright.config.ts` starts `next dev` itself,
so `test:e2e` needs no separately running server; run `npx playwright install` once to fetch browsers.

Every PR must pass its workflow's test job before merge (see branch protection notes in
`.github/workflows/README.md`).

## Dependency notes

- **`postcss` is pinned via `overrides` in `pnpm-workspace.yaml`.** Next 15 pins a PostCSS version with known
  advisories; the override forces a patched release without a breaking upgrade to Next 16. Drop
  it once Next ships a fixed PostCSS.
- **Vitest is on 4.x, not 5.x.** Vitest 5 requires Node 22+, and CI runs Node 20. Bump both
  together. The same applies to `jsdom` (kept on 29.x; 30+ needs Node 22+).
- **`next-env.d.ts` and `*.tsbuildinfo` are git-ignored.** Next generates them; `pnpm --filter @spm-t5/web
  run typecheck` runs `next typegen` first so it works on a fresh checkout.
- Don't blanket-apply audit fixes — they can force major-version upgrades (Next, Vitest) across the
  whole monorepo. Fix advisories deliberately, one PR each.
