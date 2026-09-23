# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ConnectSphere — an event management platform. Next.js/React frontend, five Node/TypeScript
microservices, one shared Supabase Postgres. npm workspaces monorepo (`apps/*`, `services/*`,
`packages/*`).

Repo layout and rationale: @README.md
Why microservices + shared DB: @docs/architecture/adr/0001-microservice-architecture.md

## Commands

Run `npm install` once from the repo root — it installs every workspace. Never run `npm install`
inside a service or app directory.

```bash
npm run dev -w apps/web                      # Next.js dev server
npm run dev -w services/auth-service         # tsx watch on one service

npm run test:all                             # every workspace
npm run test -w apps/web                     # one workspace
npm run test:unit -w services/auth-service   # unit only (vitest run tests/unit)
npm run test:integration -w services/auth-service
npm run test:unit -w services/auth-service -- tests/unit/health.test.ts   # single file
npm run test:unit -w services/auth-service -- -t "reports ok status"      # single test by name

npm run typecheck -w services/auth-service   # tsc --noEmit
npm run lint:all
npm run test:e2e -w apps/web                 # Playwright
```

Local full stack: create a root `.env` (variables listed in README → Getting started), then `supabase start` (the Supabase CLI stack runs
separately — `docker-compose.yml` deliberately does not duplicate it) and `docker compose up -d`.

## Architecture

**Supabase Auth owns all credentials.** `profiles.id` is a foreign key to `auth.users(id)`
(`supabase/migrations/0001_init.sql`). Password hashing, email confirmation, session tokens and
JWT issuance are GoTrue's job. Never add `bcrypt`, `jsonwebtoken`, or a hand-rolled session
table — `auth-service` wraps Supabase Auth, it does not reimplement it.

**Authorization is Row-Level Security, not application code.** ADR 0001 chose one Postgres
instance for all five services with RLS enforcing per-role access. A service that queries with
the service-role key bypasses RLS entirely, so reach for the anon/user-scoped client by default
and use the service-role key only where bypassing is the actual intent.

**Every service is a workspace with its own `package.json`, `tests/`, `Dockerfile`, and CI
workflow.** Docker builds use the repo root as context (the lockfile and `packages/shared` live
there), and each service's `build` script bundles `packages/shared` in with esbuild. The per-service workflows under `.github/workflows/service-*-ci.yml` are thin
callers of `_service-ci-template.yml`; the real pipeline lives in the template. Path filters mean
a change to one service only runs that service's tests — but every filter also includes
`packages/shared/**`, so a shared-package change triggers all of them.

**`packages/shared` exists to stop frontend and services drifting.** Role types, Supabase client
wrapper, and validation schemas belong there, so `apps/web` and a service validate identically
rather than duplicating a zod schema on each side. It's consumed as TypeScript source
(`"main": "src/index.ts"`), not built.

**`apps/web` calls services directly over HTTP** — no API gateway, no BFF. See
`docs/architecture/c4/container.puml` for which service owns what. Browser-visible config must be
prefixed `NEXT_PUBLIC_`; service ports are mapped in `docker-compose.yml` (auth 4001, event 4002,
venue 4003, coordinator 4004, notification 4005).

## Conventions

- **Migrations are append-only.** `supabase/migrations/` is the schema source of truth. Add a new
  numbered file; never edit one that's already been applied. Schema changes can affect multiple
  services — flag them in the PR.
- **Tests live in `tests/unit` and `tests/integration` per workspace**, not colocated with source.
  The CI template runs the two separately, and only `test:unit` gets `--coverage`.
- **Export the Express app separately from `listen()`** so integration tests can mount it without
  binding a port.
- **`src/app/` in `apps/web` is routes only** — every folder is a URL segment. Components go in
  `src/components/`, browser helpers in `src/lib/`.
- **Architecture changes need a diagram or ADR update.** The PR template has checkboxes for it;
  `docs/architecture/c4/rendered/` is CI-generated, so edit the `.puml` source only.

## Current state

The repo is scaffolding — most `services/*/src/index.ts` files export a `healthCheck()` stub and
nothing else. Declared dependencies (express, zod) are real intent, not yet real code.

Known gaps to fix rather than work around:
- RLS is enabled on `profiles` with no policy covering it, so all non-service-role access to that
  table is denied.
- Services export `healthCheck()` but never call `listen()`, so their containers start and exit
  immediately under `docker compose up`.
