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
- **`apps/web`** is the Next.js app. It calls services directly (BFF-less) or through an API
  gateway if you add one later — start simple, add a gateway service only if you need it.
- **Automated testing runs on every push/PR**, scoped to whatever changed, so a new feature in
  `event-service` doesn't wait on unrelated frontend tests, and vice versa. See
  [`.github/workflows/README.md`](.github/workflows/README.md).
- **C4 diagrams live in `docs/architecture/c4`** as PlantUML source (`.puml`), version-controlled
  like code, and are auto-rendered to SVG/PNG by CI on every change (see
  [`docs/architecture/README.md`](docs/architecture/README.md)).

## AI coding agents

Project instructions for coding agents live in [`CLAUDE.md`](CLAUDE.md), which Claude Code reads.
`AGENTS.md` is a symlink to it, so OpenAI Codex (and other tools that read `AGENTS.md`) get the
same instructions. Edit `CLAUDE.md` only — never replace the `AGENTS.md` symlink with a copy.

On Windows, git checks symlinks out as plain text files unless symlinks are enabled: turn on
Developer Mode and run `git config core.symlinks true` before cloning, or work in WSL.

## Getting started

Requires Node 20+ (CI runs Node 20) and npm. The repo is an npm workspaces monorepo — run
`npm install` once from the root; never inside a service or app directory.

```bash
npm install             # installs all workspaces
supabase start          # local Supabase stack via the Supabase CLI (optional, for full-stack dev)
docker compose up -d    # the five services + web (does not include Supabase)
npm run dev -w apps/web
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
npm run test:all                                # every workspace
npm test -w services/event-service              # one workspace
npm run test:unit -w services/auth-service      # unit only
npm run test:integration -w services/auth-service
npm run test:e2e -w apps/web                    # Playwright (tests/e2e)
```

`apps/web/vitest.config.ts` excludes `tests/e2e/**` so Vitest doesn't try to run the Playwright
specs.

Every PR must pass its workflow's test job before merge (see branch protection notes in
`.github/workflows/README.md`).

## Dependency notes

- **`postcss` is pinned via root `overrides`.** Next 15 pins a PostCSS version with known
  advisories; the override forces a patched release without a breaking upgrade to Next 16. Drop
  it once Next ships a fixed PostCSS.
- **Vitest is on 4.x, not 5.x.** Vitest 5 requires Node 22+, and CI runs Node 20. Bump both
  together.
- Don't use `npm audit fix --force` — it applies major-version upgrades (Next, Vitest) across the
  whole monorepo. Fix advisories deliberately, one PR each.
